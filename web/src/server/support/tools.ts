import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { isFinal, STATUS_LABEL } from "@/lib/format";
import { reference } from "@/lib/support";
import { windowEnds } from "../agent/timing";
import type { Ctx } from "../context";
import { SOURCE_CHAINS, type ChainKey } from "../crosschain/chains";
import { depositMoves, deposits } from "../db/schema";
import { isUniqueViolation } from "../errors";
import { formatUsdc } from "../domain/money";
import { hitRateLimit, refundRateHit } from "../services/rateLimits";
import { advanceWithRules } from "../services/rules";
import { chargeOf, refreshPendingSteps, transfersFor, type Transfer } from "../services/transfers";
import type { User } from "../services/users";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Everything the support agent can do, and nothing else (support agent spec). None of these makes,
 * changes or refunds a payment: the writes only move a person's own money along steps it was already
 * taking, or send the person their own receipt. A test pins this list.
 */
export const TOOL_NAMES = ["list_payments", "get_payment", "list_deposits", "recheck_payment", "retry_deposit", "resend_receipts", "hand_over"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export type ToolSpec = { name: ToolName; description: string; input: z.ZodType };
/** `text` is plain words: what the model reads back, and the action line the person sees for a write. */
export type ToolResult = { ok: boolean; text: string };

/** A reference as people type it: any case, spaces allowed. "latest" means the newest one. */
const ref = z
  .string()
  .transform((s) => s.replace(/\s+/g, "").toUpperCase())
  .refine((s) => s === "LATEST" || /^[A-Z0-9]{12}$/.test(s), "Not a reference");
const byRef = z.object({ ref: ref.describe('The 12-character reference the person gave, or "latest" for their newest one') });
const none = z.object({});

export const TOOLS: ToolSpec[] = [
  { name: "list_payments", description: "The person's 10 most recent payments, newest first, with references and statuses.", input: none },
  { name: "get_payment", description: "One of the person's payments: amount, who it pays, status and when.", input: byRef },
  { name: "list_deposits", description: "The person's 5 most recent deposits from other networks, with references and statuses.", input: none },
  {
    name: "recheck_payment",
    description: "Checks a payment that hasn't finished and moves it on if it can. Does nothing to a finished payment.",
    input: byRef,
  },
  {
    name: "retry_deposit",
    description: "Starts the next attempt on a deposit that stopped on its way to the person's balance. Once a day per deposit.",
    input: byRef,
  },
  { name: "resend_receipts", description: "Emails the person a link to a delivered payment, where every receipt is.", input: byRef },
  {
    name: "hand_over",
    description: "Passes the chat to the Splits team, who reply by email within 24 hours. Ends the chat.",
    input: z.object({ summary: z.string().min(1).max(600).describe("One or two sentences for the team: what the person needs and what you found") }),
  },
];

const NO_PAYMENT: ToolResult = { ok: false, text: "No payment with that reference on your account." };
const NO_DEPOSIT: ToolResult = { ok: false, text: "No deposit with that reference on your account." };
const NEEDS_PERSON = "A person on the Splits team will need to look at this one.";

const DEPOSIT_WORDS: Record<string, string> = {
  detected: "Arrived, about to move to your balance",
  waiting: "Waiting for more to arrive before it can move",
  moving: "On its way to your balance",
  ready: "In your balance",
  stuck: "Stopped on its way to your balance",
  carried: "In your balance, moved with an earlier deposit",
};

const day = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

function paymentLine(t: Transfer): string {
  const names = t.expected.map((l) => l.name);
  const to = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
  return `${reference(t.id)}: $${formatUsdc(chargeOf(t))} to ${to}. ${STATUS_LABEL[t.status] ?? t.status}. ${day(t.createdAt)}.`;
}

async function findPayment(ctx: Ctx, user: User, wanted: string): Promise<Transfer | null> {
  const mine = await transfersFor(ctx, user.id, 50);
  if (wanted === "LATEST") return mine[0] ?? null;
  return mine.find((t) => reference(t.id) === wanted) ?? null;
}

async function myDeposits(ctx: Ctx, user: User, limit: number) {
  return ctx.db.select().from(deposits).where(eq(deposits.userId, user.id)).orderBy(desc(deposits.createdAt)).limit(limit);
}

async function findDeposit(ctx: Ctx, user: User, wanted: string) {
  const mine = await myDeposits(ctx, user, 50);
  if (wanted === "LATEST") return mine[0] ?? null;
  return mine.find((d) => reference(d.id) === wanted) ?? null;
}

function depositLine(d: typeof deposits.$inferSelect, stuck: boolean): string {
  const network = SOURCE_CHAINS[d.chain as ChainKey]?.name ?? d.chain;
  const words = stuck ? DEPOSIT_WORDS.stuck : (DEPOSIT_WORDS[d.status] ?? d.status);
  return `${reference(d.id)}: $${formatUsdc(BigInt(d.amount))} from ${network}. ${words}. ${day(d.createdAt)}.`;
}

/**
 * Whether a deposit has stopped. Its own status never says so (deposits.ts, retry()): after the burn
 * it stays "moving" on a stuck move; before the burn it goes back to "waiting" while its address's
 * latest move sits stuck.
 */
async function isStuck(ctx: Ctx, d: typeof deposits.$inferSelect): Promise<boolean> {
  if (d.moveId) {
    const [m] = await ctx.db.select({ status: depositMoves.status }).from(depositMoves).where(eq(depositMoves.id, d.moveId)).limit(1);
    return m?.status === "stuck";
  }
  if (d.status !== "waiting") return false;
  const [latest] = await ctx.db
    .select({ status: depositMoves.status, burnTxHash: depositMoves.burnTxHash })
    .from(depositMoves)
    .where(eq(depositMoves.depositWalletId, d.depositWalletId))
    .orderBy(desc(depositMoves.createdAt))
    .limit(1);
  return latest?.status === "stuck" && !latest.burnTxHash;
}

async function getPayment(ctx: Ctx, user: User, wanted: string): Promise<ToolResult> {
  const t = await findPayment(ctx, user, wanted);
  if (!t) return NO_PAYMENT;
  const legs = t.expected.map((l) => `${l.name} $${formatUsdc(BigInt(l.amount))}${l.purpose ? ` for ${l.purpose}` : ""}`).join("; ");
  return { ok: true, text: `${paymentLine(t)} Paying: ${legs}.` };
}

async function recheckPayment(ctx: Ctx, user: User, wanted: string): Promise<ToolResult> {
  const t = await findPayment(ctx, user, wanted);
  if (!t) return NO_PAYMENT;
  if (isFinal(t.status)) return { ok: true, text: `Payment ${reference(t.id)} has already finished: ${STATUS_LABEL[t.status]}.` };
  if (!(await hitRateLimit(ctx, `support:recheck:${t.id}`, 3, HOUR))) {
    return { ok: false, text: `Payment ${reference(t.id)} was checked a few times already. It can be checked again at ${windowEnds(ctx, HOUR)} UTC.` };
  }
  await refreshPendingSteps(ctx, t.id);
  // With rules, as the payment page does: settling here must still tell people and start automatic splits.
  const after = await advanceWithRules(ctx, t.id, 10_000);
  return { ok: true, text: `Checked payment ${reference(t.id)} again: ${STATUS_LABEL[after.status] ?? after.status}.` };
}

/**
 * Two kinds of stuck (deposits.ts, retry()): before its burn a move lets its deposits go back to
 * waiting, so they only need queueing again; after the burn the move goes back to the step it
 * stopped at. A move whose mint landed is never touched: the money is in the balance.
 */
/** Another move on the address became active first (deposit_moves_one_active): nothing changed. */
function lostRace(err: unknown): never[] {
  if (isUniqueViolation(err)) return [];
  throw err;
}

async function retryDeposit(ctx: Ctx, user: User, wanted: string): Promise<ToolResult> {
  const d = await findDeposit(ctx, user, wanted);
  if (!d) return NO_DEPOSIT;
  const [move] = d.moveId
    ? await ctx.db.select().from(depositMoves).where(eq(depositMoves.id, d.moveId)).limit(1)
    : await ctx.db
        .select()
        .from(depositMoves)
        .where(and(eq(depositMoves.depositWalletId, d.depositWalletId), eq(depositMoves.status, "stuck")))
        .orderBy(desc(depositMoves.createdAt))
        .limit(1);
  if (!move || move.status !== "stuck" || (!d.moveId && move.burnTxHash)) {
    return { ok: false, text: `Deposit ${reference(d.id)} isn't stuck: ${DEPOSIT_WORDS[d.status] ?? d.status}.` };
  }
  if (move.mintTxHash) return { ok: false, text: `Deposit ${reference(d.id)} has already reached your balance. ${NEEDS_PERSON}` };
  if (move.burnTxHash) {
    if (!move.resumeStatus) return { ok: false, text: `Deposit ${reference(d.id)} can't be restarted from here. ${NEEDS_PERSON}` };
    const [busy] = await ctx.db
      .select({ id: depositMoves.id })
      .from(depositMoves)
      .where(and(eq(depositMoves.depositWalletId, move.depositWalletId), inArray(depositMoves.status, ["burning", "attesting", "minting"])))
      .limit(1);
    if (busy) return { ok: false, text: `Another deposit is moving through the same address. ${NEEDS_PERSON}` };
  }
  if (!(await hitRateLimit(ctx, `support:retry:${move.id}`, 1, DAY))) {
    return { ok: false, text: `Deposit ${reference(d.id)} was already restarted today. ${NEEDS_PERSON}` };
  }
  const changed = move.burnTxHash
    ? await ctx.db
        .update(depositMoves)
        .set({ status: move.resumeStatus!, attempts: 0, resumes: move.resumes + 1, lastError: null, updatedAt: ctx.now() })
        .where(and(eq(depositMoves.id, move.id), eq(depositMoves.status, "stuck")))
        .returning({ id: depositMoves.id })
        .catch(lostRace)
    : await ctx.db
        .update(deposits)
        .set({ status: "detected", updatedAt: ctx.now() })
        .where(and(eq(deposits.depositWalletId, move.depositWalletId), eq(deposits.userId, user.id), eq(deposits.status, "waiting")))
        .returning({ id: deposits.id });
  // Something else moved it first (the sweeper, or another move on the same address): nothing was restarted.
  if (!changed.length) {
    await refundRateHit(ctx, `support:retry:${move.id}`, DAY);
    return { ok: false, text: `Deposit ${reference(d.id)} changed while I was restarting it. ${NEEDS_PERSON}` };
  }
  return { ok: true, text: `Started the next attempt to move deposit ${reference(d.id)} to your balance.` };
}

async function resendReceipts(ctx: Ctx, user: User, wanted: string): Promise<ToolResult> {
  const t = await findPayment(ctx, user, wanted);
  if (!t) return NO_PAYMENT;
  if (t.status !== "settled") return { ok: false, text: `Payment ${reference(t.id)} hasn't been delivered, so it has no receipts yet.` };
  if (!(await hitRateLimit(ctx, `support:receipts:${t.id}`, 1, HOUR))) {
    return { ok: false, text: `The link for payment ${reference(t.id)} was sent within the last hour. Check ${user.email}, including spam.` };
  }
  await ctx.email.sendReceiptLink(user.email, { amount: formatUsdc(chargeOf(t)), url: `${ctx.appUrl}/payments/${t.id}` });
  return { ok: true, text: `Sent the link to payment ${reference(t.id)} and its receipts to ${user.email}.` };
}

/** Runs one tool for the signed-in person. Bad names and inputs come back as refusals, never throws. */
export async function runTool(ctx: Ctx, user: User, name: string, input: unknown): Promise<ToolResult> {
  const spec = TOOLS.find((t) => t.name === name);
  if (!spec) return { ok: false, text: `There is no tool called ${name}.` };
  const parsed = spec.input.safeParse(input ?? undefined);
  if (!parsed.success) return { ok: false, text: "That isn't a reference I can look up. References are 12 letters and numbers." };
  const wanted = (parsed.data as { ref?: string }).ref ?? "";
  switch (spec.name) {
    case "list_payments": {
      const mine = await transfersFor(ctx, user.id, 10);
      return { ok: true, text: mine.length ? mine.map(paymentLine).join("\n") : "You haven't made any payments yet." };
    }
    case "get_payment":
      return getPayment(ctx, user, wanted);
    case "list_deposits": {
      const mine = await myDeposits(ctx, user, 5);
      const lines = await Promise.all(mine.map(async (d) => depositLine(d, await isStuck(ctx, d))));
      return { ok: true, text: lines.length ? lines.join("\n") : "No money has been added from another network yet." };
    }
    case "recheck_payment":
      return recheckPayment(ctx, user, wanted);
    case "retry_deposit":
      return retryDeposit(ctx, user, wanted);
    case "resend_receipts":
      return resendReceipts(ctx, user, wanted);
    case "hand_over":
      return { ok: false, text: "handled by chat" };
  }
}
