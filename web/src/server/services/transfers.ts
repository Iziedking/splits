import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { encodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { splitsRouterAbi } from "../chain/abi";
import type { OnchainLeg, RouterReceipt } from "../chain/types";
import type { Ctx } from "../context";
import { providerTxs, transfers, wallets, type ExpectedLeg, type TransferStatus } from "../db/schema";
import { FEE_PURPOSE, feeFor } from "../domain/fees";
import { FIAT_CURRENCIES, quote as fxQuote, QuoteError } from "../domain/fx";
import { transferRef } from "../domain/ids";
import { formatUsdc, MoneyError, parseUsdc, purposeToBytes32 } from "../domain/money";
import { AppError, badRequest, conflict, forbidden, notFound } from "../errors";
import { confirmAction, createAction, type Action, type Confirmation } from "./actions";
import { claimDraft, consumeDraft } from "./payouts";
import { findProviderTx, refreshProviderTx, submitOnce } from "./providerTx";
import { checkSendLimit, withSendLimitLock } from "./sendLimits";
import { expectedAmounts, getSplit } from "./splits";
import { mainWallet, type User } from "./users";

export type Transfer = typeof transfers.$inferSelect;

const LEASE_MS = 30_000;

/** What leaves the sender: the recipients' total plus the Splits fee. */
export const chargeOf = (t: Pick<Transfer, "amount" | "feeAmount">) => BigInt(t.amount) + BigInt(t.feeAmount);

const paying = (legs: ExpectedLeg[]) => legs.filter((l) => BigInt(l.amount) > 0n);

/** The legs the router pays: every recipient with an amount, then the Splits fee. */
export function routerLegs(t: Pick<Transfer, "expected" | "feeAmount" | "feeAddress">): OnchainLeg[] {
  const legs: OnchainLeg[] = paying(t.expected).map((l) => ({
    recipient: getAddress(l.address),
    fixedAmount: BigInt(l.amount),
    shareBps: 0,
    purpose: purposeToBytes32(l.purpose),
  }));
  if (BigInt(t.feeAmount) > 0n) {
    legs.push({ recipient: getAddress(t.feeAddress!), fixedAmount: BigInt(t.feeAmount), shareBps: 0, purpose: purposeToBytes32(FEE_PURPOSE) });
  }
  return legs;
}
const ACTIVE: TransferStatus[] = ["awaiting_wallet", "confirmed", "funding", "approving", "sending", "verifying"];

const splitTransferInput = z.discriminatedUnion("fundWith", [
  z.object({
    splitId: z.uuid(),
    fundWith: z.literal("card"),
    currency: z.enum(FIAT_CURRENCIES),
    fiatMinor: z.number().int(),
  }),
  z.object({ splitId: z.uuid(), fundWith: z.literal("balance"), usdc: z.string() }),
]);

/** Pays a checked list once. The amount is the list's total; nothing about it can be changed here. */
const draftTransferInput = z.object({
  draftId: z.uuid(),
  draftHash: z.string().regex(/^[0-9a-f]{64}$/),
  fundWith: z.enum(["card", "balance"]),
});

export const transferInput = z.union([draftTransferInput, splitTransferInput]);

export type TransferInput = z.infer<typeof transferInput>;

/**
 * Prices a payment, through one of the user's active splits or a checked list, and waits for
 * confirmation. A checked list is used up here, so it can only ever back one payment.
 */
export async function quoteTransfer(
  ctx: Ctx,
  user: User,
  input: TransferInput,
): Promise<{ transfer: Transfer; action: Action }> {
  const { kind, split, draft, wallet, amount, fee, charge, quoteData, topUp, expected } = await priceTransfer(ctx, user, input);
  // A friendly early refusal. The enforcing check is at confirm, under the lock. The fee counts.
  await checkSendLimit(ctx.db, ctx, { userId: user.id, email: user.email }, "account", charge);
  const id = randomUUID();
  const [transfer] = await ctx.db
    .insert(transfers)
    .values({
      id,
      payerUserId: user.id,
      payerWalletId: wallet.id,
      payerAddress: wallet.address,
      funding: topUp > 0n ? "card" : "balance",
      kind,
      splitId: split?.id ?? null,
      splitVersion: split?.version ?? null,
      amount: amount.toString(),
      feeAmount: fee.amount.toString(),
      feeBps: fee.bps,
      feeAddress: fee.amount > 0n ? ctx.fees.address : null,
      quote: quoteData,
      topUp: topUp.toString(),
      expected,
      ref: transferRef(id),
      status: "awaiting_confirmation",
      createdAt: ctx.now(),
      updatedAt: ctx.now(),
    })
    .returning();

  if (draft && !(await consumeDraft(ctx, draft.id, id))) {
    await ctx.db.update(transfers).set({ status: "cancelled", updatedAt: ctx.now() }).where(eq(transfers.id, id));
    throw conflict("LIST_ALREADY_PAID", "This list was already paid");
  }

  const action = await createAction(ctx, user.id, "transfer", id, {
    split: split?.name ?? `${expected.length} people`,
    amount: amount.toString(),
    quote: quoteData,
    legs: expected,
  });
  return { transfer: transfer!, action };
}

/** The exact breakdown a payment would have, without creating anything. */
export async function previewTransfer(ctx: Ctx, user: User, input: TransferInput) {
  const { amount, fee, charge, quoteData, expected } = await priceTransfer(ctx, user, input);
  return {
    amount: formatUsdc(amount),
    fee: formatUsdc(fee.amount),
    feePercent: fee.bps / 100,
    total: formatUsdc(charge),
    rate: quoteData ? formatUsdc(BigInt(quoteData.rate as string)) : null,
    simulatedCard: quoteData !== null,
    legs: expected.map((l) => ({ ...l, amount: formatUsdc(BigInt(l.amount)) })),
  };
}

async function assertBalance(ctx: Ctx, address: Address, amount: bigint) {
  const balance = await ctx.chain.usdcBalance(address);
  if (balance < amount) throw badRequest("INSUFFICIENT_BALANCE", `You have ${formatUsdc(balance)} USDC`);
}

async function priceTransfer(ctx: Ctx, user: User, input: TransferInput) {
  const wallet = await mainWallet(ctx, user.id);
  if (!wallet) throw conflict("NO_WALLET", "Your wallet is still being set up");

  if ("draftId" in input) {
    const draft = await claimDraft(ctx, user, input.draftId, input.draftHash);
    const amount = BigInt(draft.total);
    const expected: ExpectedLeg[] = draft.legs.map((l) => ({
      name: l.name,
      address: l.address,
      amount: l.amount,
      purpose: l.purpose,
      email: l.email,
    }));
    const fee = feeFor(amount, paying(expected).length, ctx.fees.rule);
    const charge = amount + fee.amount;
    const topUp = input.fundWith === "card" ? charge : 0n;
    if (topUp > 0n) assertFundingShape(ctx, topUp);
    if (input.fundWith === "balance") await assertBalance(ctx, wallet.address as Address, charge);
    // The demo card is charged in dollars at 1:1, so the quote is the list total plus the fee.
    const quoteData =
      input.fundWith === "card"
        ? { currency: "USD", fiatMinor: Number(charge / 10_000n), rate: "1000000", usdc: charge.toString(), simulated: true }
        : null;
    return { kind: "pay" as const, split: null, draft, wallet, amount, fee, charge, quoteData, topUp, expected };
  }

  const split = await getSplit(ctx, input.splitId);
  if (split.ownerUserId !== user.id) throw notFound("Split not found");
  if (split.status !== "active" || split.onchainId === null) {
    throw conflict("SPLIT_NOT_READY", "This split isn't active yet");
  }
  if (split.autoForWalletId) throw badRequest("SPLIT_IS_RULE", "Automatic splits run on their own");

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

  const expected: ExpectedLeg[] = expectedAmounts(split, amount).map((l, i) => ({
    ...l,
    amount: l.amount.toString(),
    email: split.legs[i]!.email,
  }));
  const fee = feeFor(amount, paying(expected).length, ctx.fees.rule);
  const charge = amount + fee.amount;
  const topUp = input.fundWith === "card" ? charge : 0n;
  if (topUp > 0n) assertFundingShape(ctx, topUp);
  if (input.fundWith === "balance") await assertBalance(ctx, wallet.address as Address, charge);
  return { kind: "send" as const, split, draft: null, wallet, amount, fee, charge, quoteData, topUp, expected };
}

/** PIN or passkey moves the payment to confirmed. The caller then drives it with advanceWithRules. */
export async function confirmTransfer(ctx: Ctx, user: User, actionId: string, proof: Confirmation): Promise<Transfer> {
  const action = await confirmAction(ctx, user.id, actionId, proof);
  if (action.type !== "transfer") throw badRequest("WRONG_ACTION", "That confirmation is not for a payment");
  const t = await getTransfer(ctx, action.subjectId);
  let moved: Transfer | undefined;
  try {
    moved = await withSendLimitLock(ctx, async (tx) => {
      await checkSendLimit(tx, ctx, { userId: user.id, email: user.email }, "account", chargeOf(t));
      const [row] = await tx
        .update(transfers)
        .set({ status: "confirmed", updatedAt: ctx.now() })
        .where(and(eq(transfers.id, t.id), eq(transfers.status, "awaiting_confirmation")))
        .returning();
      return row;
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "SEND_LIMIT") {
      await ctx.db
        .update(transfers)
        .set({ status: "cancelled", lastError: err.message, updatedAt: ctx.now() })
        .where(and(eq(transfers.id, t.id), eq(transfers.status, "awaiting_confirmation")));
    }
    throw err;
  }
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
  if (status === "settled" || status === "failed" || status === "cancelled") {
    await ctx.db.update(wallets).set({ busyTransferId: null }).where(eq(wallets.busyTransferId, t.id));
  }
  return row;
}

/** Claims the payer wallet for this payment, or reports that another payment holds it. */
async function claimWalletSlot(ctx: Ctx, t: Transfer): Promise<boolean> {
  if (!t.payerWalletId) return true;
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

async function payerWallet(ctx: Ctx, t: Transfer): Promise<{ address: Address; providerWalletId: string }> {
  if (!t.payerWalletId) throw new Error(`Transfer ${t.id} has no Splits wallet`);
  const [w] = await ctx.db.select().from(wallets).where(eq(wallets.id, t.payerWalletId)).limit(1);
  if (!w) throw new Error(`Payer wallet ${t.payerWalletId} missing`);
  return { address: w.address as Address, providerWalletId: w.providerWalletId };
}

const fail = (lastError: string): StepResult => ({ status: "failed", patch: { lastError } });

async function step(ctx: Ctx, t: Transfer): Promise<StepResult> {
  if (t.funding === "own_wallet") {
    if (t.status === "awaiting_wallet") {
      if (t.txHash) return { status: "verifying" };
      const found = await ctx.chain.findSplitSent(t.payerAddress as Address, t.ref as Hex, t.fromBlock ?? 0n);
      if (found) return { status: "verifying", patch: { txHash: found } };
      if (t.expiresAt && t.expiresAt <= ctx.now()) {
        return { status: "cancelled", patch: { lastError: "No payment arrived within 30 minutes" } };
      }
      // Checked and still waiting: move to the back of the reservation queue.
      await ctx.db.update(transfers).set({ updatedAt: ctx.now() }).where(eq(transfers.id, t.id));
      return "wait";
    }
    if (t.status === "verifying") return verify(ctx, t);
    return "wait";
  }

  const amount = chargeOf(t);
  const payer = await payerWallet(ctx, t);

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
      let callData: Hex;
      if (t.kind === "auto") {
        // A receiver's own rule runs its onchain split as it stands. It pays no fee.
        if (t.splitId === null || t.splitVersion === null) return fail("Split is missing");
        const split = await getSplit(ctx, t.splitId);
        if (split.onchainId === null) return fail("Split is not onchain");
        callData = encodeFunctionData({
          abi: splitsRouterAbi,
          functionName: "send",
          args: [split.onchainId, t.splitVersion, amount, t.ref as Hex],
        });
      } else {
        if (t.kind === "send") {
          // Saved splits pay through pay() so the fee can ride along; the template must be unchanged.
          if (t.splitId === null || t.splitVersion === null) return fail("Split is missing");
          const split = await getSplit(ctx, t.splitId);
          if (split.status !== "active") return fail(notSent(t, "SplitInactive"));
          if (split.version !== t.splitVersion) return fail(notSent(t, "VersionMismatch"));
          // The stored legs must still be what the template gives for this amount; the template,
          // not the payment row, is the independent record of what the sender approved.
          const fromTemplate = expectedAmounts(split, BigInt(t.amount));
          const same =
            fromTemplate.length === t.expected.length &&
            fromTemplate.every(
              (l, i) => l.address.toLowerCase() === t.expected[i]!.address.toLowerCase() && l.amount === BigInt(t.expected[i]!.amount),
            );
          if (!same) return fail("This payment does not match what was approved. Flagged for review. Nothing was sent.");
        }
        // Exactly the legs the sender approved, then the fee.
        callData = encodeFunctionData({ abi: splitsRouterAbi, functionName: "pay", args: [routerLegs(t), amount, t.ref as Hex] });
      }
      let row = await submitOnce(ctx, t.id, "send", 1, (idempotencyKey) =>
        ctx.wallets.execute({
          walletId: payer.providerWalletId,
          contract: ctx.router,
          callData,
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
      return fail(notSent(t, row.error ?? row.rawState));
    }

    case "verifying":
      return verify(ctx, t);

    default:
      return "wait";
  }
}

/**
 * Checks the Arc receipt against what was approved: the payer, the ref, and every leg (the fee
 * last). Anything else fails and is flagged; nothing is settled on a guess.
 */
async function verify(ctx: Ctx, t: Transfer): Promise<StepResult> {
  if (!t.txHash) return "wait";
  const receipt = await ctx.chain.receipt(t.txHash as Hex);
  if (t.funding === "own_wallet" && !(receipt && receiptMatches(t, receipt))) return recoverOwnWallet(ctx, t, receipt);
  if (!receipt) return "wait";
  if (receipt.status !== "success") return fail("The payment reverted onchain");
  if (!receiptMatches(t, receipt) || !(await ctx.chain.refUsed(t.payerAddress as Address, t.ref as Hex))) {
    return fail("Onchain receipt does not match what was approved. Flagged for review.");
  }
  return { status: "settled", patch: { lastError: null } };
}

/** Grace after a reservation ends before a hash that never appears is given up on. */
const UNSEEN_HASH_GRACE_MS = 10 * 60_000;

/**
 * The submitted hash didn't prove the payment (it reverted, never appeared, or isn't this payer's).
 * The ref decides instead: it is unique to this reservation and payer, so if it was spent, Arc holds
 * the visitor's real transaction (a wallet retry, a speed-up, a Safe hash) and we switch to it.
 */
async function recoverOwnWallet(ctx: Ctx, t: Transfer, receipt: RouterReceipt | null): Promise<StepResult> {
  const payer = t.payerAddress as Address;
  if (await ctx.chain.refUsed(payer, t.ref as Hex)) {
    const found = await ctx.chain.findSplitSent(payer, t.ref as Hex, t.fromBlock ?? 0n);
    if (found && found.toLowerCase() !== t.txHash!.toLowerCase()) return { status: "verifying", patch: { txHash: found } };
    if (!found) return "wait"; // spent, but the node hasn't indexed the log yet
    return fail("Onchain receipt does not match what was approved. Flagged for review.");
  }
  // Nothing has left the visitor's wallet under this reservation.
  const expired = t.expiresAt !== null && t.expiresAt <= ctx.now();
  const reopen = (lastError: string): StepResult =>
    expired ? { status: "cancelled", patch: { txHash: null, lastError } } : { status: "awaiting_wallet", patch: { txHash: null, lastError } };
  if (receipt?.status === "reverted") return reopen("The send reverted onchain. Nothing moved from your wallet.");
  if (receipt) return fail("Onchain receipt does not match what was approved. Flagged for review.");
  if (t.expiresAt && t.expiresAt.getTime() + UNSEEN_HASH_GRACE_MS <= ctx.now().getTime()) {
    return reopen("That transaction never appeared on Arc. Nothing moved from your wallet.");
  }
  return "wait";
}

function receiptMatches(t: Transfer, receipt: RouterReceipt): boolean {
  if (receipt.status !== "success") return false;
  const payer = t.payerAddress.toLowerCase();
  const sent = receipt.splitSent.some((s) => s.ref.toLowerCase() === t.ref.toLowerCase() && s.payer.toLowerCase() === payer);
  const paid = receipt.legPaid.filter((l) => l.ref.toLowerCase() === t.ref.toLowerCase());
  const want = routerLegs(t);
  return (
    sent &&
    paid.length === want.length &&
    paid.every((p, i) => p.recipient.toLowerCase() === want[i]!.recipient.toLowerCase() && p.amount === want[i]!.fixedAmount)
  );
}

/**
 * What the sender reads when the payout call failed. The caller has already checked onchain that
 * the ref is unused, so nothing moved; the provider often reports only a generic reason, so the
 * revert name is a bonus, not a requirement. A card top-up that already landed stays with them.
 */
function notSent(t: Transfer, error: string): string {
  const topUp = BigInt(t.topUp);
  const kept = topUp > 0n ? ` $${formatUsdc(topUp)} from the demo card is still in your balance.` : "";
  return `${revertReason(error)} Nothing was sent.${kept}`;
}

function revertReason(error: string): string {
  if (error.includes("VersionMismatch")) return "The split changed after you confirmed.";
  if (error.includes("SplitInactive")) return "This split is paused.";
  if (error.includes("Blocklist")) return "One recipient can't receive USDC right now.";
  if (error.includes("InsufficientBalance")) return "Not enough USDC in your wallet.";
  if (error.includes("InsufficientAllowance")) return "Approval was too low.";
  if (error.includes("InvalidRecipient")) return "One recipient can't be paid.";
  return "Arc rejected the payment.";
}

/** Transfers that still have work to do and nobody holding them. */
export async function activeTransferIds(ctx: Ctx, limit: number): Promise<string[]> {
  return idsIn(ctx, ACTIVE.filter((s) => s !== "awaiting_wallet"), limit);
}

/**
 * Own-wallet reservations still waiting for the visitor's wallet, least recently checked first. A
 * queue of their own, so many open reservations never crowd out payments that are moving.
 */
export async function openReservationIds(ctx: Ctx, limit: number): Promise<string[]> {
  return idsIn(ctx, ["awaiting_wallet"], limit);
}

async function idsIn(ctx: Ctx, statuses: TransferStatus[], limit: number): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: transfers.id })
    .from(transfers)
    .where(and(inArray(transfers.status, statuses), or(isNull(transfers.leaseUntil), lt(transfers.leaseUntil, ctx.now()))))
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

/**
 * Asks the provider about any step it hasn't confirmed yet. A payment can settle onchain while a
 * step record still says pending (the chain showed the approval before Circle reported it), so the
 * payment screen calls this to keep the step list honest.
 */
export async function refreshPendingSteps(ctx: Ctx, transferId: string): Promise<void> {
  const rows = await transferSteps(ctx, transferId);
  await Promise.all(rows.filter((r) => r.status === "pending").map((r) => refreshProviderTx(ctx, r)));
}
