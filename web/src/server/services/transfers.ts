import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { z } from "zod";
import { splitsRouterAbi } from "../chain/abi";
import type { Ctx } from "../context";
import { providerTxs, transfers, wallets, type ExpectedLeg, type TransferStatus } from "../db/schema";
import { FIAT_CURRENCIES, quote as fxQuote, QuoteError } from "../domain/fx";
import { transferRef } from "../domain/ids";
import { formatUsdc, MoneyError, parseUsdc } from "../domain/money";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { confirmAction, createAction, type Action, type Confirmation } from "./actions";
import { findProviderTx, refreshProviderTx, submitOnce } from "./providerTx";
import { expectedAmounts, getSplit } from "./splits";
import { mainWallet, type User } from "./users";

export type Transfer = typeof transfers.$inferSelect;

const LEASE_MS = 30_000;
const ACTIVE: TransferStatus[] = ["confirmed", "funding", "approving", "sending", "verifying"];

export const transferInput = z.discriminatedUnion("fundWith", [
  z.object({
    splitId: z.uuid(),
    fundWith: z.literal("card"),
    currency: z.enum(FIAT_CURRENCIES),
    fiatMinor: z.number().int(),
  }),
  z.object({ splitId: z.uuid(), fundWith: z.literal("balance"), usdc: z.string() }),
]);

export type TransferInput = z.infer<typeof transferInput>;

/** Prices a payment against one of the user's active splits and waits for confirmation. */
export async function quoteTransfer(
  ctx: Ctx,
  user: User,
  input: TransferInput,
): Promise<{ transfer: Transfer; action: Action }> {
  const split = await getSplit(ctx, input.splitId);
  if (split.ownerUserId !== user.id) throw notFound("Split not found");
  if (split.status !== "active" || split.onchainId === null) {
    throw conflict("SPLIT_NOT_READY", "This split isn't active yet");
  }
  if (split.autoForWalletId) throw badRequest("SPLIT_IS_RULE", "Automatic splits run on their own");
  const wallet = await mainWallet(ctx, user.id);
  if (!wallet) throw conflict("NO_WALLET", "Your wallet is still being set up");

  let amount: bigint;
  let quoteData: Record<string, unknown> | null = null;
  try {
    if (input.fundWith === "card") {
      const q = fxQuote(input.currency, input.fiatMinor, ctx.rates);
      amount = q.usdcAmount;
      quoteData = { currency: q.currency, fiatMinor: q.fiatMinor, rate: q.rate, usdc: q.usdc, simulated: true };
    } else {
      amount = parseUsdc(input.usdc);
    }
  } catch (err) {
    if (err instanceof QuoteError || err instanceof MoneyError) throw badRequest("INVALID_AMOUNT", err.message);
    throw err;
  }
  if (amount === 0n) throw badRequest("INVALID_AMOUNT", "Amount must be more than zero");

  const topUp = input.fundWith === "card" ? amount : 0n;
  if (topUp > 0n) assertFundingShape(ctx, topUp);
  if (input.fundWith === "balance") {
    const balance = await ctx.chain.usdcBalance(wallet.address as Address);
    if (balance < amount) throw badRequest("INSUFFICIENT_BALANCE", `You have ${formatUsdc(balance)} USDC`);
  }

  const expected: ExpectedLeg[] = expectedAmounts(split, amount).map((l) => ({ ...l, amount: l.amount.toString() }));
  const id = randomUUID();
  const [transfer] = await ctx.db
    .insert(transfers)
    .values({
      id,
      payerUserId: user.id,
      payerWalletId: wallet.id,
      kind: "send",
      splitId: split.id,
      splitVersion: split.version,
      amount: amount.toString(),
      quote: quoteData,
      topUp: topUp.toString(),
      expected,
      ref: transferRef(id),
      status: "awaiting_confirmation",
      createdAt: ctx.now(),
      updatedAt: ctx.now(),
    })
    .returning();

  const action = await createAction(ctx, user.id, "transfer", id, {
    split: split.name,
    amount: amount.toString(),
    quote: quoteData,
    legs: expected,
  });
  return { transfer: transfer!, action };
}

/** PIN or passkey moves the payment to confirmed. The caller then drives it with advanceWithRules. */
export async function confirmTransfer(ctx: Ctx, user: User, actionId: string, proof: Confirmation): Promise<Transfer> {
  const action = await confirmAction(ctx, user.id, actionId, proof);
  if (action.type !== "transfer") throw badRequest("WRONG_ACTION", "That confirmation is not for a payment");
  const [moved] = await ctx.db
    .update(transfers)
    .set({ status: "confirmed", updatedAt: ctx.now() })
    .where(and(eq(transfers.id, action.subjectId), eq(transfers.status, "awaiting_confirmation")))
    .returning();
  if (!moved) throw conflict("ALREADY_CONFIRMED", "This payment is already under way");
  return moved;
}

// ------------------------------------------------------------------ funding caps

function assertFundingShape(ctx: Ctx, topUp: bigint) {
  if (!ctx.limits.fundingEnabled) throw forbidden("FUNDING_OFF", "Card top-ups are switched off right now");
  if (topUp > ctx.limits.maxPerTopUp) {
    throw badRequest("FUNDING_LIMIT", `Card top-ups are limited to ${formatUsdc(ctx.limits.maxPerTopUp)} USDC each`);
  }
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Reserves a top-up against the per-user and global daily caps. An advisory lock serialises
 * reservations, so two payments at once can't both squeeze under the same cap.
 */
async function reserveFunding(ctx: Ctx, t: Transfer): Promise<string | null> {
  const topUp = BigInt(t.topUp);
  try {
    assertFundingShape(ctx, topUp);
  } catch (err) {
    return err instanceof Error ? err.message : "Top-up refused";
  }
  const now = ctx.now();
  const day = startOfUtcDay(now);
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('splits:funding'))`);
    const [current] = await tx.select({ fundedAt: transfers.fundedAt }).from(transfers).where(eq(transfers.id, t.id));
    if (current?.fundedAt) return null;

    const [sums] = await tx
      .select({
        user: sql<string>`coalesce(sum(case when ${transfers.payerUserId} = ${t.payerUserId} then ${transfers.topUp}::numeric else 0 end), 0)::text`,
        global: sql<string>`coalesce(sum(${transfers.topUp}::numeric), 0)::text`,
      })
      .from(transfers)
      .where(gte(transfers.fundedAt, day));
    const userTotal = BigInt(sums?.user ?? "0") + topUp;
    const globalTotal = BigInt(sums?.global ?? "0") + topUp;
    if (userTotal > ctx.limits.perUserDaily) {
      return `You've reached today's card top-up limit of ${formatUsdc(ctx.limits.perUserDaily)} USDC`;
    }
    if (globalTotal > ctx.limits.globalDaily) return "Card top-ups are at today's limit. Try again tomorrow.";
    await tx.update(transfers).set({ fundedAt: now }).where(eq(transfers.id, t.id));
    return null;
  });
}

// ------------------------------------------------------------------ the state machine

type StepResult = { status: TransferStatus; patch?: Partial<Transfer> } | "wait";

/**
 * Moves a payment forward as far as it can right now. Safe to call from anywhere, any number of
 * times: a lease means only one caller works on a transfer at once, every provider write is
 * idempotent, and every step re-reads chain state before acting on it.
 */
export async function advanceTransfer(ctx: Ctx, transferId: string, budgetMs = 15_000): Promise<Transfer> {
  const started = Date.now();
  const leased = await acquireLease(ctx, transferId);
  if (!leased) return getTransfer(ctx, transferId);

  let t = leased;
  try {
    while (ACTIVE.includes(t.status) && Date.now() - started < budgetMs) {
      const result = await step(ctx, t);
      if (result === "wait") break;
      t = await setStatus(ctx, t, result.status, result.patch);
    }
  } catch (err) {
    // An unexpected error (RPC down, provider 5xx) leaves the transfer where it was for a retry.
    await ctx.db
      .update(transfers)
      .set({ lastError: err instanceof Error ? err.message.slice(0, 500) : "Unknown error" })
      .where(eq(transfers.id, transferId));
    throw err;
  } finally {
    await ctx.db.update(transfers).set({ leaseUntil: null }).where(eq(transfers.id, transferId));
  }
  return getTransfer(ctx, transferId);
}

async function acquireLease(ctx: Ctx, transferId: string): Promise<Transfer | undefined> {
  const now = ctx.now();
  const [row] = await ctx.db
    .update(transfers)
    .set({ leaseUntil: new Date(now.getTime() + LEASE_MS) })
    .where(
      and(
        eq(transfers.id, transferId),
        inArray(transfers.status, ACTIVE),
        or(isNull(transfers.leaseUntil), lt(transfers.leaseUntil, now)),
      ),
    )
    .returning();
  return row;
}

async function setStatus(ctx: Ctx, t: Transfer, status: TransferStatus, patch: Partial<Transfer> = {}) {
  const [row] = await ctx.db
    .update(transfers)
    .set({ ...patch, status, updatedAt: ctx.now(), ...(status === "settled" ? { settledAt: ctx.now() } : {}) })
    .where(and(eq(transfers.id, t.id), eq(transfers.status, t.status)))
    .returning();
  if (!row) throw new Error(`Transfer ${t.id} changed under its lease`);
  if (status === "settled" || status === "failed") {
    await ctx.db.update(wallets).set({ busyTransferId: null }).where(eq(wallets.busyTransferId, t.id));
  }
  return row;
}

/** Claims the payer wallet for this payment, or reports that another payment holds it. */
async function claimWalletSlot(ctx: Ctx, t: Transfer): Promise<boolean> {
  const finished = ctx.db
    .select({ id: transfers.id })
    .from(transfers)
    .where(inArray(transfers.status, ["settled", "failed", "cancelled"]));
  const claimed = await ctx.db
    .update(wallets)
    .set({ busyTransferId: t.id })
    .where(
      and(
        eq(wallets.id, t.payerWalletId),
        or(isNull(wallets.busyTransferId), eq(wallets.busyTransferId, t.id), inArray(wallets.busyTransferId, finished)),
      ),
    )
    .returning({ id: wallets.id });
  return claimed.length === 1;
}

async function payerAddress(ctx: Ctx, t: Transfer): Promise<{ address: Address; providerWalletId: string }> {
  const [w] = await ctx.db.select().from(wallets).where(eq(wallets.id, t.payerWalletId)).limit(1);
  if (!w) throw new Error(`Payer wallet ${t.payerWalletId} missing`);
  return { address: w.address as Address, providerWalletId: w.providerWalletId };
}

const fail = (lastError: string): StepResult => ({ status: "failed", patch: { lastError } });

async function step(ctx: Ctx, t: Transfer): Promise<StepResult> {
  const amount = BigInt(t.amount);
  const payer = await payerAddress(ctx, t);

  switch (t.status) {
    case "confirmed": {
      if (BigInt(t.topUp) === 0n) return { status: "approving" };
      const refused = await reserveFunding(ctx, t);
      if (refused) return fail(refused);
      await submitOnce(ctx, t.id, "fund", 1, (idempotencyKey) =>
        ctx.wallets.transferUsdc({
          walletId: ctx.treasuryWalletId,
          to: payer.address,
          amount: BigInt(t.topUp),
          idempotencyKey,
          refId: `fund:${t.id}`,
        }),
      );
      return { status: "funding" };
    }

    case "funding": {
      const row = await refreshProviderTx(ctx, (await findProviderTx(ctx, t.id, "fund"))!);
      if (row.status === "pending") return "wait";
      if (row.status === "failed") return fail(`Top-up failed: ${row.error ?? row.rawState}`);
      // Read after write: wait until the node shows the money before spending it.
      if ((await ctx.chain.usdcBalance(payer.address)) < amount) return "wait";
      return { status: "approving" };
    }

    case "approving": {
      if (!(await claimWalletSlot(ctx, t))) return "wait";
      // The chain can show the approval before the provider reports it; keep the step record honest.
      const earlier = await findProviderTx(ctx, t.id, "approve");
      if (earlier) await refreshProviderTx(ctx, earlier);
      if ((await ctx.chain.usdcAllowance(payer.address, ctx.router)) >= amount) return { status: "sending" };
      let row = await submitOnce(ctx, t.id, "approve", 1, (idempotencyKey) =>
        ctx.wallets.execute({
          walletId: payer.providerWalletId,
          contract: ctx.usdc,
          callData: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ctx.router, amount] }),
          idempotencyKey,
          refId: `approve:${t.id}`,
        }),
      );
      row = await refreshProviderTx(ctx, row);
      if (row.status === "pending") return "wait";
      if (row.status === "failed") return fail(`Approval failed: ${row.error ?? row.rawState}`);
      return (await ctx.chain.usdcAllowance(payer.address, ctx.router)) >= amount ? { status: "sending" } : "wait";
    }

    case "sending": {
      const split = await getSplit(ctx, t.splitId);
      if (split.onchainId === null) return fail("Split is not onchain");
      let row = await submitOnce(ctx, t.id, "send", 1, (idempotencyKey) =>
        ctx.wallets.execute({
          walletId: payer.providerWalletId,
          contract: ctx.router,
          callData: encodeFunctionData({
            abi: splitsRouterAbi,
            functionName: "send",
            args: [split.onchainId!, t.splitVersion, amount, t.ref as Hex],
          }),
          idempotencyKey,
          refId: `send:${t.id}`,
        }),
      );
      row = await refreshProviderTx(ctx, row);
      if (row.status === "pending") return "wait";
      if (row.status === "complete" && row.txHash) return { status: "verifying", patch: { txHash: row.txHash } };
      // The provider says it failed. Trust the chain: if the ref is spent, the payment happened.
      if (await ctx.chain.refUsed(payer.address, t.ref as Hex)) {
        return row.txHash ? { status: "verifying", patch: { txHash: row.txHash } } : "wait";
      }
      return fail(friendlyRevert(row.error ?? row.rawState));
    }

    case "verifying": {
      if (!t.txHash) return "wait";
      const receipt = await ctx.chain.receipt(t.txHash as Hex);
      if (!receipt) return "wait";
      if (receipt.status !== "success") return fail("The payment reverted onchain");
      const paid = receipt.legPaid.filter((l) => l.ref.toLowerCase() === t.ref.toLowerCase());
      const want = t.expected.filter((l) => BigInt(l.amount) > 0n);
      const matches =
        paid.length === want.length &&
        paid.every(
          (p, i) => p.recipient.toLowerCase() === want[i]!.address.toLowerCase() && p.amount === BigInt(want[i]!.amount),
        );
      if (!matches || !(await ctx.chain.refUsed(payer.address, t.ref as Hex))) {
        return fail("Onchain receipt does not match the expected split. Flagged for review.");
      }
      return { status: "settled", patch: { lastError: null } };
    }

    default:
      return "wait";
  }
}

function friendlyRevert(error: string): string {
  if (error.includes("VersionMismatch")) return "The split changed after you confirmed. Nothing was sent.";
  if (error.includes("SplitInactive")) return "This split is paused. Nothing was sent.";
  if (error.includes("Blocklist")) return "One recipient can't receive USDC right now. Nothing was sent.";
  if (error.includes("InsufficientBalance")) return "Not enough USDC in your wallet. Nothing was sent.";
  if (error.includes("InsufficientAllowance")) return "Approval was too low. Nothing was sent.";
  return `The payment was rejected: ${error}`;
}

/** Transfers that still have work to do and nobody holding them. */
export async function activeTransferIds(ctx: Ctx, limit: number): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: transfers.id })
    .from(transfers)
    .where(and(inArray(transfers.status, ACTIVE), or(isNull(transfers.leaseUntil), lt(transfers.leaseUntil, ctx.now()))))
    .orderBy(transfers.updatedAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

// ------------------------------------------------------------------ reads

export async function getTransfer(ctx: Ctx, id: string): Promise<Transfer> {
  const [t] = await ctx.db.select().from(transfers).where(eq(transfers.id, id)).limit(1);
  if (!t) throw notFound("Payment not found");
  return t;
}

export async function transfersFor(ctx: Ctx, userId: string, limit = 50): Promise<Transfer[]> {
  return ctx.db
    .select()
    .from(transfers)
    .where(eq(transfers.payerUserId, userId))
    .orderBy(desc(transfers.createdAt))
    .limit(limit);
}

export async function transferSteps(ctx: Ctx, transferId: string) {
  return ctx.db.select().from(providerTxs).where(eq(providerTxs.subjectId, transferId));
}
