import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { getAddress, isAddress } from "viem";
import type { Ctx } from "../context";
import { transfers, type ExpectedLeg } from "../db/schema";
import { emailSchema } from "../domain/email";
import { feeFor } from "../domain/fees";
import { randomToken, transferRef } from "../domain/ids";
import { formatUsdc } from "../domain/money";
import { badRequest, conflict, notFound, tooMany } from "../errors";
import { checkPayout, claimDraft, consumeDraft, DRAFT_TTL_MS, type PayoutCheck, type PayoutCheckInput } from "./payouts";
import { hitRateLimit } from "./rateLimits";
import { checkSendLimit, withSendLimitLock } from "./sendLimits";
import { chargeOf, routerLegs, type Transfer } from "./transfers";

export type Visitor = { keyHash: string; ip: string | null };
export type PreparedPayment = {
  transfer: Transfer;
  legs: { recipient: Address; fixedAmount: string; shareBps: 0; purpose: Hex }[];
  balance: string;
  allowance: string;
};

const HOUR = 3_600_000;
const TOKEN = /^[A-Za-z0-9_-]{24}$/;
const LATE_WINDOW_MS = 24 * HOUR;
const LATE_CHECK_EVERY_MS = 30_000;

/** One hit against this visitor's hourly budget for `what`, by cookie and (behind our proxy) by IP. */
async function visitorAllowed(ctx: Ctx, visitor: Visitor, what: "check" | "prepare"): Promise<boolean> {
  const max = ctx.limits.visitorChecksPerHour;
  const allowed = [await hitRateLimit(ctx, `${what}:v:${visitor.keyHash}`, max, HOUR)];
  if (visitor.ip) allowed.push(await hitRateLimit(ctx, `${what}:ip:${visitor.ip}`, max, HOUR));
  return !allowed.includes(false);
}

/** A visitor's list, checked exactly like an account's, behind per-visitor and per-IP limits. */
export async function checkVisitorList(ctx: Ctx, visitor: Visitor, input: PayoutCheckInput): Promise<PayoutCheck> {
  if (!(await visitorAllowed(ctx, visitor, "check"))) throw tooMany("TOO_MANY_CHECKS", "Too many checks from here. Try again in an hour.");
  // A backstop across all visitors: each check runs RPC probes and stores a list.
  if (!(await hitRateLimit(ctx, "check:all", ctx.limits.visitorChecksGlobalPerHour, HOUR))) {
    throw tooMany("TOO_MANY_CHECKS", "Splits is busy checking lists right now. Try again shortly.");
  }
  const check = await checkPayout(ctx, { visitorKeyHash: visitor.keyHash }, input);
  if (check.ready && check.totalUnits) {
    const total = BigInt(check.totalUnits);
    await checkSendLimit(ctx.db, ctx, {}, "visitor", total + feeFor(total, check.lines.length, ctx.fees.rule).amount);
  }
  return check;
}

/** Reserves a visitor's checked list against their limits and returns what their wallet signs. */
export async function prepareVisitorPayment(
  ctx: Ctx,
  visitor: Visitor,
  input: { draftId: string; draftHash: string; payer: Address; email?: string | null },
): Promise<PreparedPayment> {
  if (!(await visitorAllowed(ctx, visitor, "prepare"))) throw tooMany("TOO_MANY_PREPARES", "Too many payments started from here. Try again in an hour.");
  if (!isAddress(input.payer, { strict: false })) throw badRequest("INVALID_ADDRESS", "That wallet address isn't valid");
  const payer = getAddress(input.payer);
  const email = input.email ? emailSchema.parse(input.email.trim().toLowerCase()) : null;
  const draft = await claimDraft(ctx, { visitorKeyHash: visitor.keyHash }, input.draftId, input.draftHash);
  const amount = BigInt(draft.total);
  const expected: ExpectedLeg[] = draft.legs.map((l) => ({ name: l.name, address: l.address, amount: l.amount, purpose: l.purpose, email: l.email }));
  const fee = feeFor(amount, expected.filter((l) => BigInt(l.amount) > 0n).length, ctx.fees.rule);
  const id = randomUUID();
  const fromBlock = await ctx.chain.blockNumber();

  const transfer = await withSendLimitLock(ctx, async (tx) => {
    await checkSendLimit(tx, ctx, { address: payer, email }, "visitor", amount + fee.amount);
    const [row] = await tx
      .insert(transfers)
      .values({
        id,
        payerUserId: null,
        payerWalletId: null,
        payerAddress: payer,
        funding: "own_wallet",
        kind: "pay",
        amount: amount.toString(),
        feeAmount: fee.amount.toString(),
        feeBps: fee.bps,
        feeAddress: fee.amount > 0n ? ctx.fees.address : null,
        topUp: "0",
        expected,
        ref: transferRef(id),
        status: "awaiting_wallet",
        expiresAt: new Date(ctx.now().getTime() + DRAFT_TTL_MS),
        visitorToken: randomToken(18),
        visitorEmail: email,
        fromBlock,
        createdAt: ctx.now(),
        updatedAt: ctx.now(),
      })
      .returning();
    return row!;
  });
  if (!(await consumeDraft(ctx, draft.id, id))) {
    await ctx.db.update(transfers).set({ status: "cancelled", updatedAt: ctx.now() }).where(eq(transfers.id, id));
    throw conflict("LIST_ALREADY_PAID", "This list was already paid");
  }
  const [balance, allowance] = await Promise.all([ctx.chain.usdcBalance(payer), ctx.chain.usdcAllowance(payer, ctx.router)]);
  return {
    transfer,
    // Exactly what the verifier will expect: recipients, then the fee leg.
    legs: routerLegs(transfer).map((l) => ({ ...l, fixedAmount: l.fixedAmount.toString(), shareBps: 0 as const })),
    balance: balance.toString(),
    allowance: allowance.toString(),
  };
}

export async function visitorPaymentByToken(ctx: Ctx, token: string): Promise<Transfer> {
  if (!TOKEN.test(token)) throw notFound("Payment not found");
  const [t] = await ctx.db.select().from(transfers).where(eq(transfers.visitorToken, token)).limit(1);
  if (!t) throw notFound("Payment not found");
  return t;
}

/** The visitor's page reports the transaction. Repeating the same hash is harmless. */
export async function submitVisitorPayment(ctx: Ctx, token: string, txHash: Hex): Promise<Transfer> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw badRequest("INVALID_TX", "That isn't a transaction hash");
  const t = await visitorPaymentByToken(ctx, token);
  if (t.txHash) {
    if (t.txHash.toLowerCase() === txHash.toLowerCase()) return t;
    throw conflict("OTHER_TRANSACTION", "This payment already has a transaction");
  }
  const [row] = await ctx.db
    .update(transfers)
    .set({ txHash, status: "verifying", updatedAt: ctx.now() })
    .where(and(eq(transfers.id, t.id), isNull(transfers.txHash), inArray(transfers.status, ["awaiting_wallet", "cancelled"])))
    .returning();
  return row ?? visitorPaymentByToken(ctx, token);
}

/** Sends the visitor a link to their payment, once it has landed. */
export async function emailVisitorReceipt(ctx: Ctx, token: string, rawEmail: string): Promise<void> {
  const email = emailSchema.parse(rawEmail.trim().toLowerCase());
  const t = await visitorPaymentByToken(ctx, token);
  if (t.status !== "settled") throw conflict("NOT_LANDED", "You can email the receipt once the payment lands");
  if (!(await hitRateLimit(ctx, `receipt:${t.id}`, 3, 24 * HOUR))) {
    throw tooMany("TOO_MANY_RECEIPTS", "This receipt was already emailed three times today");
  }
  await ctx.email.sendReceiptLink(email, { amount: formatUsdc(chargeOf(t)), url: `${ctx.appUrl}/p/${t.visitorToken}` });
}

/**
 * Cancelled reservations from the last 24 hours whose payment landed anyway (the page closed, or
 * the wallet took its time). Each found one moves to verifying and is settled like any other.
 *
 * Each is checked at most every LATE_CHECK_EVERY_MS, with one read of whether its ref was spent;
 * only a spent ref is worth the log search for its transaction. Scanning every abandoned
 * reservation's logs on every sweep used up Arc's public RPC limit and broke balance reads.
 */
export async function findLatePayments(ctx: Ctx, limit: number): Promise<number> {
  const since = new Date(ctx.now().getTime() - LATE_WINDOW_MS);
  const checkedBefore = new Date(ctx.now().getTime() - LATE_CHECK_EVERY_MS);
  const rows = await ctx.db
    .select()
    .from(transfers)
    .where(
      and(
        eq(transfers.funding, "own_wallet"),
        eq(transfers.status, "cancelled"),
        isNull(transfers.txHash),
        gt(transfers.createdAt, since),
        lt(transfers.updatedAt, checkedBefore),
      ),
    )
    .orderBy(asc(transfers.updatedAt))
    .limit(limit);
  let found = 0;
  for (const t of rows) {
    let hash: Hex | null;
    try {
      const spent = await ctx.chain.refUsed(t.payerAddress as Address, t.ref as Hex);
      hash = spent ? await ctx.chain.findSplitSent(t.payerAddress as Address, t.ref as Hex, t.fromBlock ?? 0n) : null;
    } catch (err) {
      console.error(`[late payments] ${t.id}`, err);
      hash = null;
    }
    if (!hash) {
      // Checked: rotate to the back so the next sweep looks at others first.
      await ctx.db.update(transfers).set({ updatedAt: ctx.now() }).where(and(eq(transfers.id, t.id), eq(transfers.status, "cancelled")));
      continue;
    }
    const moved = await ctx.db
      .update(transfers)
      .set({ txHash: hash, status: "verifying", updatedAt: ctx.now() })
      .where(and(eq(transfers.id, t.id), eq(transfers.status, "cancelled"), isNull(transfers.txHash)))
      .returning({ id: transfers.id });
    found += moved.length;
  }
  return found;
}
