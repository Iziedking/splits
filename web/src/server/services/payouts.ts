import { and, eq, gt, isNull } from "drizzle-orm";
import type { Address } from "viem";
import { z } from "zod";
import type { Ctx } from "../context";
import { payoutDrafts, type DraftLeg } from "../db/schema";
import { SplitRuleError } from "../domain/allocation";
import { feeFor } from "../domain/fees";
import { sha256Hex } from "../domain/ids";
import { formatUsdc, parseUsdc, purposeToBytes32 } from "../domain/money";
import { equalPot, parsePayoutLines, recipientKey, type PayoutTarget } from "../domain/payouts";
import { badRequest, conflict, notFound } from "../errors";
import { ensureRecipientWallet, mainWallet, type User } from "./users";

export const DRAFT_TTL_MS = 30 * 60_000;

/** A list checked by someone without an account: owned by the hash of their visitor cookie. */
export type VisitorOwner = { visitorKeyHash: string };
export type DraftOwner = User | VisitorOwner;
const isVisitor = (o: DraftOwner): o is VisitorOwner => "visitorKeyHash" in o;
export type Draft = typeof payoutDrafts.$inferSelect;

export const payoutCheckInput = z.object({
  mode: z.enum(["equal", "each"]),
  text: z.string().max(40_000),
  pot: z.string().optional(),
  label: z.string().trim().min(1).max(31),
});
export type PayoutCheckInput = z.infer<typeof payoutCheckInput>;

export type LineStatus = "ready" | "invalid" | "duplicate" | "self" | "cant_receive" | "wallet_failed" | "check_failed";
export type CheckLine = {
  line: number;
  raw: string;
  recipient: string | null;
  amount: string | null;
  label: string;
  status: LineStatus;
  message: string | null;
};
export type PayoutCheck = {
  lines: CheckLine[];
  total: string | null;
  ready: boolean;
  /** The total in USDC base units, for exact arithmetic. */
  totalUnits: string | null;
  /** The Splits fee the sender would pay on top, and the whole charge. */
  fee: string | null;
  feePercent: number;
  charge: string | null;
  maxRecipients: number;
  draft: { id: string; hash: string; expiresAt: string } | null;
};

const MESSAGES = {
  duplicate: "This person is already on the list",
  self: "That's your own wallet",
  cant_receive: "This address can't receive USDC right now",
  wallet_failed: "Couldn't set up a wallet for this email. Check again to retry.",
  wallets_busy: "Too many new people were added in the last hour. Check again later.",
  check_failed: "Couldn't check this line. Check again.",
  no_amount: "Add an amount, like 5 or 2.50",
} as const;

/** A line while it is being checked. */
type Working = {
  line: number;
  raw: string;
  target: PayoutTarget | null;
  label: string;
  status: LineStatus;
  message: string | null;
  cents: bigint | null;
  address: Address | null;
  walletId: string | null;
};

export function draftHash(legs: DraftLeg[], total: bigint): string {
  return sha256Hex(
    JSON.stringify({ total: total.toString(), legs: legs.map((l) => [l.address.toLowerCase(), l.amount, l.purpose]) }),
  );
}

/** Runs in small batches so a long list doesn't open hundreds of RPC or provider calls at once. */
async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(run));
}

function flag(l: Working, status: Exclude<LineStatus, "ready">, message: string) {
  l.status = status;
  l.message = message;
}

/**
 * Reads a pasted list, works out every amount, makes sure every person can be paid, and saves
 * the result as a draft the sender can approve. Nothing moves here.
 */
export async function checkPayout(ctx: Ctx, owner: DraftOwner, input: PayoutCheckInput): Promise<PayoutCheck> {
  try {
    purposeToBytes32(input.label);
  } catch {
    throw badRequest("LABEL_TOO_LONG", "The label is longer than 31 bytes");
  }
  const parsed = parsePayoutLines(input.text);
  if (parsed.length === 0) throw badRequest("EMPTY_LIST", "Add at least one person");
  if (parsed.length > ctx.limits.maxPayoutRecipients) {
    throw badRequest(
      "TOO_MANY_RECIPIENTS",
      `One payment can reach up to ${ctx.limits.maxPayoutRecipients} people. Split this list into two payouts.`,
    );
  }

  const lines: Working[] = parsed.map((p) => ({
    line: p.line,
    raw: p.raw,
    target: p.target,
    label: p.label ?? input.label.trim(),
    status: p.problem ? "invalid" : "ready",
    message: p.problem,
    cents: p.amount,
    address: p.target?.type === "address" ? p.target.address : null,
    walletId: null,
  }));

  // Duplicates, and the sender's own email or wallet.
  const mine = isVisitor(owner) ? undefined : (await mainWallet(ctx, owner.id))?.address.toLowerCase();
  const seen = new Set<string>();
  for (const l of lines) {
    if (l.status !== "ready" || !l.target) continue;
    const key = recipientKey(l.target);
    if (seen.has(key)) flag(l, "duplicate", MESSAGES.duplicate);
    seen.add(key);
    const self =
      (l.target.type === "email" && !isVisitor(owner) && l.target.email === owner.email) ||
      (l.target.type === "address" && l.target.address.toLowerCase() === mine);
    if (l.status === "ready" && self) flag(l, "self", MESSAGES.self);
  }

  // Amounts: from each line, or an equal share of the pot for every line.
  if (input.mode === "each") {
    for (const l of lines) if (l.status === "ready" && l.cents === null) flag(l, "invalid", MESSAGES.no_amount);
  } else {
    let pot: bigint;
    try {
      pot = parseUsdc(input.pot ?? "");
    } catch {
      throw badRequest("INVALID_AMOUNT", "Enter the pot, like 100 or 25.50");
    }
    try {
      const parts = equalPot(pot, lines.length);
      lines.forEach((l, i) => (l.cents = parts[i]!));
    } catch (err) {
      if (err instanceof SplitRuleError) throw badRequest(err.code, err.message);
      throw err;
    }
  }

  // A wallet for every email (idempotent; new ones are capped per sender and in total).
  const sender = isVisitor(owner) ? `v:${owner.visitorKeyHash}` : `u:${owner.id}`;
  await inBatches(lines, 5, async (l) => {
    if (l.status !== "ready" || l.target?.type !== "email") return;
    try {
      const wallet = await ensureRecipientWallet(ctx, l.target.email, sender);
      if (!wallet) return flag(l, "wallet_failed", MESSAGES.wallets_busy);
      l.address = wallet.address as Address;
      l.walletId = wallet.id;
    } catch (err) {
      console.error(`[payouts] wallet for line ${l.line}`, err);
      flag(l, "wallet_failed", MESSAGES.wallet_failed);
    }
  });

  // The same person can be named twice in different ways: by email and by their wallet address.
  const paid = new Set<string>();
  for (const l of lines) {
    if (l.status !== "ready" || !l.address) continue;
    const key = l.address.toLowerCase();
    if (key === mine) flag(l, "self", MESSAGES.self);
    else if (paid.has(key)) flag(l, "duplicate", MESSAGES.duplicate);
    paid.add(key);
  }

  // A no-cost probe that each address can receive. A network failure is not the recipient's fault.
  await inBatches(lines, 5, async (l) => {
    if (l.status !== "ready" || !l.address) return;
    try {
      if (!(await ctx.chain.canReceive(ctx.treasuryAddress, l.address))) flag(l, "cant_receive", MESSAGES.cant_receive);
    } catch (err) {
      console.error(`[payouts] probe for line ${l.line}`, err);
      flag(l, "check_failed", MESSAGES.check_failed);
    }
  });

  const out: CheckLine[] = lines.map((l) => ({
    line: l.line,
    raw: l.raw,
    recipient: l.target ? (l.target.type === "email" ? l.target.email : l.target.address) : null,
    amount: l.cents === null ? null : formatUsdc(l.cents),
    label: l.label,
    status: l.status,
    message: l.message,
  }));
  const ready = lines.every((l) => l.status === "ready");
  const total = lines.every((l) => l.cents !== null) ? lines.reduce((sum, l) => sum + l.cents!, 0n) : null;
  const fee = total === null ? null : feeFor(total, lines.length, ctx.fees.rule);
  const base = {
    lines: out,
    total: total === null ? null : formatUsdc(total),
    totalUnits: total === null ? null : total.toString(),
    fee: fee === null ? null : formatUsdc(fee.amount),
    feePercent: fee === null ? 0 : fee.bps / 100,
    charge: total === null || fee === null ? null : formatUsdc(total + fee.amount),
    maxRecipients: ctx.limits.maxPayoutRecipients,
  };
  if (!ready || total === null) return { ...base, ready: false, draft: null };

  const legs: DraftLeg[] = lines.map((l) => ({
    name: l.target!.type === "email" ? l.target!.email : `${l.address!.slice(0, 6)}…${l.address!.slice(-4)}`,
    email: l.target!.type === "email" ? l.target!.email : null,
    walletId: l.walletId,
    address: l.address!,
    amount: l.cents!.toString(),
    purpose: l.label,
  }));
  const hash = draftHash(legs, total);
  const expiresAt = new Date(ctx.now().getTime() + DRAFT_TTL_MS);
  const [draft] = await ctx.db
    .insert(payoutDrafts)
    .values({
      ownerUserId: isVisitor(owner) ? null : owner.id,
      visitorKeyHash: isVisitor(owner) ? owner.visitorKeyHash : null,
      legs,
      total: total.toString(),
      hash,
      expiresAt,
      createdAt: ctx.now(),
    })
    .returning();
  return { ...base, ready: true, draft: { id: draft!.id, hash, expiresAt: expiresAt.toISOString() } };
}

/** The draft behind an approval, if it is the sender's, unchanged, unexpired and not yet paid. */
export async function claimDraft(ctx: Ctx, owner: DraftOwner, draftId: string, hash: string): Promise<Draft> {
  const [draft] = await ctx.db.select().from(payoutDrafts).where(eq(payoutDrafts.id, draftId)).limit(1);
  const mine = isVisitor(owner) ? draft?.visitorKeyHash === owner.visitorKeyHash : draft?.ownerUserId === owner.id;
  if (!draft || !mine) throw notFound("This list no longer exists. Check it again.");
  if (draft.consumedAt) throw conflict("LIST_ALREADY_PAID", "This list was already paid");
  if (draft.hash !== hash || draft.expiresAt <= ctx.now()) throw conflict("LIST_CHANGED", "This list changed. Check it again.");
  return draft;
}

/** Marks a draft used by one payment. Returns false if another payment got there first. */
export async function consumeDraft(ctx: Ctx, draftId: string, transferId: string): Promise<boolean> {
  const rows = await ctx.db
    .update(payoutDrafts)
    .set({ consumedAt: ctx.now(), transferId })
    .where(and(eq(payoutDrafts.id, draftId), isNull(payoutDrafts.consumedAt), gt(payoutDrafts.expiresAt, ctx.now())))
    .returning({ id: payoutDrafts.id });
  return rows.length === 1;
}
