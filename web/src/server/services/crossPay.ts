import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { encodeFunctionData, getAddress, hexToNumber, isAddress, keccak256, slice, type Address, type Hex } from "viem";
import type { Ctx } from "../context";
import { encodeDepositForBurnWithHook, encodeHook, FAST, maxFeeFor, nonceOf, parseBurnMessage, type BurnLog } from "../crosschain/cctp";
import { crossPayAbi } from "../crosschain/crossPayAbi";
import { SOURCE_CHAINS, type ChainKey, type SourceChain } from "../crosschain/chains";
import { crossPayments, transfers, type CrossPayment, type ExpectedLeg } from "../db/schema";
import { emailSchema } from "../domain/email";
import { feeFor } from "../domain/fees";
import { deterministicUuid, randomToken, transferRef } from "../domain/ids";
import { formatUsdc } from "../domain/money";
import { badRequest, conflict, tooMany, unavailable } from "../errors";
import { claimDraft, consumeDraft, DRAFT_TTL_MS } from "./payouts";
import { checkSendLimit, withSendLimitLock } from "./sendLimits";
import { routerLegs, type Transfer } from "./transfers";
import { CROSS_TEXT } from "./crossMessages";
import type { StepResult } from "./stepResult";
import { visitorAllowed, visitorPaymentByToken, type Visitor } from "./visitorPayments";

/** Payments from another chain start at $1: below that, network fees outweigh the payment. */
export const CROSS_MIN_UNITS = 1_000_000n;

export type PreparedCross = {
  transfer: Transfer;
  cross: CrossPayment;
  call: { chainId: number; usdc: Address; tokenMessenger: Address; burnAmount: string; data: Hex };
  cost: { amount: string; fee: string; circleMax: string; total: string; fast: boolean };
};

/** The enabled cross-pay chain for `key`, or the "paused" error naming it. */
function crossChainFor(ctx: Ctx, key: string): SourceChain {
  const chain = ctx.crossPay?.open.find((c) => c.key === key);
  if (chain) return chain;
  const name = SOURCE_CHAINS[key as ChainKey]?.name ?? key;
  throw conflict("CHAIN_PAUSED", `Payments from ${name} are paused right now. Try another chain.`);
}

/**
 * Reserves a visitor's checked list for payment from another chain and returns the one burn their
 * wallet signs there: the split plus the Splits fee plus Circle's fee at its most, carried to
 * SplitsCrossPay with the split (and the payer as refund address) in the hook. Fast when the chain
 * offers it and Circle's Fast allowance covers it; Standard otherwise.
 */
export async function prepareCrossPayment(
  ctx: Ctx,
  visitor: Visitor,
  input: { draftId: string; draftHash: string; payer: Address; chain: string; email?: string | null },
): Promise<PreparedCross> {
  const chain = crossChainFor(ctx, input.chain);
  if (!(await visitorAllowed(ctx, visitor, "prepare"))) throw tooMany("TOO_MANY_PREPARES", "Too many payments started from here. Try again in an hour.");
  if (!isAddress(input.payer, { strict: false })) throw badRequest("INVALID_ADDRESS", "That wallet address isn't valid");
  const payer = getAddress(input.payer);
  const email = input.email ? emailSchema.parse(input.email.trim().toLowerCase()) : null;
  const { iris, network, reader } = ctx.crossChain;

  let fees: { fastBps: number; standardBps: number };
  let allowance: bigint;
  try {
    [fees, allowance] = await Promise.all([iris.fees(chain.domain), chain.fast ? iris.fastAllowance() : Promise.resolve(0n)]);
  } catch {
    throw unavailable("FEE_UNAVAILABLE", "We couldn't get Circle's fee just now. Try again in a minute.");
  }

  const draft = await claimDraft(ctx, { visitorKeyHash: visitor.keyHash }, input.draftId, input.draftHash);
  const amount = BigInt(draft.total);
  if (amount < CROSS_MIN_UNITS) throw badRequest("TOO_SMALL", "Payments from another chain need to be at least $1.");
  const expected: ExpectedLeg[] = draft.legs.map((l) => ({ name: l.name, address: l.address, amount: l.amount, purpose: l.purpose, email: l.email }));
  const fee = feeFor(amount, expected.filter((l) => BigInt(l.amount) > 0n).length, ctx.fees.rule);
  const payAmount = amount + fee.amount;
  const fastFee = maxFeeFor(payAmount, fees.fastBps);
  const fast = chain.fast && allowance >= payAmount + fastFee;
  const maxFee = fast ? fastFee : maxFeeFor(payAmount, fees.standardBps);
  const burnAmount = payAmount + maxFee;
  const id = randomUUID();
  const ref = transferRef(id);
  const [fromBlock, sourceFromBlock] = await Promise.all([ctx.chain.blockNumber(), reader.blockNumber(chain)]);

  const transfer = await withSendLimitLock(ctx, async (tx) => {
    await checkSendLimit(tx, ctx, { address: payer, email }, "visitor", payAmount);
    const [row] = await tx
      .insert(transfers)
      .values({
        id,
        payerUserId: null,
        payerWalletId: null,
        payerAddress: payer,
        funding: "cross_chain",
        kind: "pay",
        amount: amount.toString(),
        feeAmount: fee.amount.toString(),
        feeBps: fee.bps,
        feeAddress: fee.amount > 0n ? ctx.fees.address : null,
        topUp: "0",
        expected,
        ref,
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

  const hookData = encodeHook(routerLegs(transfer), payAmount, ref, payer);
  const [cross] = await ctx.db
    .insert(crossPayments)
    .values({
      transferId: id,
      chain: chain.key,
      burnAmount: burnAmount.toString(),
      maxFee: maxFee.toString(),
      fast,
      hookHash: keccak256(hookData),
      sourceFromBlock,
      phase: "awaiting_burn",
      createdAt: ctx.now(),
      updatedAt: ctx.now(),
    })
    .returning();

  return {
    transfer,
    cross: cross!,
    call: burnCall(ctx, chain, cross!, hookData),
    cost: { amount: formatUsdc(amount), fee: formatUsdc(fee.amount), circleMax: formatUsdc(maxFee), total: formatUsdc(burnAmount), fast },
  };
}

/** The burn the payer's wallet sends, rebuilt from the stored reservation. */
function burnCall(ctx: Ctx, chain: SourceChain, cp: CrossPayment, hookData: Hex): PreparedCross["call"] {
  const { network } = ctx.crossChain;
  return {
    chainId: chain.chainId[network],
    usdc: chain.usdc[network],
    tokenMessenger: ctx.crossChain.cctp.tokenMessenger,
    burnAmount: cp.burnAmount,
    data: encodeDepositForBurnWithHook({
      amount: BigInt(cp.burnAmount),
      burnToken: chain.usdc[network],
      maxFee: BigInt(cp.maxFee),
      fast: cp.fast,
      hookData,
      crossPay: ctx.crossPay!.address,
    }),
  };
}

/** The burn a payer who came back to their link (before burning) still needs to send. */
export function crossCallFor(ctx: Ctx, t: Transfer, cp: CrossPayment): PreparedCross["call"] | null {
  const chain = ctx.crossPay?.chains.find((c) => c.key === cp.chain);
  if (!chain) return null;
  const payAmount = BigInt(t.amount) + BigInt(t.feeAmount);
  return burnCall(ctx, chain, cp, encodeHook(routerLegs(t), payAmount, t.ref as Hex, t.payerAddress as Address));
}

export async function crossPaymentFor(ctx: Ctx, transferId: string): Promise<CrossPayment | undefined> {
  const [row] = await ctx.db.select().from(crossPayments).where(eq(crossPayments.transferId, transferId)).limit(1);
  return row;
}

/**
 * The visitor's page reports the burn on the source chain. The hash is only a lead: the burn check
 * (stepCrossPay) reads it on the reserved chain before anything is trusted. Repeating the same
 * hash is harmless; a second, different hash is refused.
 */
export async function submitCrossBurn(ctx: Ctx, token: string, txHash: Hex): Promise<Transfer> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw badRequest("INVALID_TX", "That isn't a transaction hash");
  const t = await visitorPaymentByToken(ctx, token);
  if (t.funding !== "cross_chain") throw badRequest("NOT_CROSS_CHAIN", "This payment isn't paid from another chain");
  const cp = (await crossPaymentFor(ctx, t.id))!;
  if (cp.burnTxHash) {
    if (cp.burnTxHash.toLowerCase() === txHash.toLowerCase()) return t;
    throw conflict("OTHER_TRANSACTION", "This payment already has a transaction");
  }
  const moved = await ctx.db
    .update(crossPayments)
    .set({ burnTxHash: txHash.toLowerCase(), phase: "burned", lastError: null, updatedAt: ctx.now() })
    .where(and(eq(crossPayments.transferId, t.id), isNull(crossPayments.burnTxHash), inArray(crossPayments.phase, ["awaiting_burn", "cancelled"])))
    .returning({ id: crossPayments.transferId });
  if (moved.length) {
    await ctx.db
      .update(transfers)
      .set({ status: "sending", updatedAt: ctx.now() })
      .where(and(eq(transfers.id, t.id), inArray(transfers.status, ["awaiting_wallet", "cancelled"])));
  }
  return visitorPaymentByToken(ctx, token);
}

/** How long a reported burn may stay unseen on its chain before it counts as never sent. */
export const BURN_SEEN_GRACE_MS = 10 * 60_000;

/** A burn is this draft's only if every field the contract and the hook depend on matches. */
export function checkBurn(burn: BurnLog, want: { crossPay: Address; burnAmount: bigint; usdc: Address; hookHash: string }): "ok" | "mismatch" {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const ok =
    same(burn.mintRecipient, want.crossPay) &&
    same(burn.destinationCaller, want.crossPay) &&
    same(burn.burnToken, want.usdc) &&
    burn.destinationDomain === 26 &&
    burn.amount >= want.burnAmount &&
    same(keccak256(burn.hookData), want.hookHash);
  return ok ? "ok" : "mismatch";
}

async function saveCross(ctx: Ctx, cp: CrossPayment, patch: Partial<CrossPayment>) {
  await ctx.db
    .update(crossPayments)
    .set({ ...patch, updatedAt: ctx.now() })
    .where(eq(crossPayments.transferId, cp.transferId));
}

/** Back to waiting for the wallet: nothing left the payer's wallet under this reservation. */
async function reopen(ctx: Ctx, cp: CrossPayment, why: "reverted" | "replaced"): Promise<StepResult> {
  await saveCross(ctx, cp, { phase: "awaiting_burn", burnTxHash: null, burnNonce: null, lastError: why });
  return { status: "awaiting_wallet" };
}

/** The chain a reservation pays from, while it is still on (cross-pay first, then deposits). */
function chainOf(ctx: Ctx, key: string): SourceChain | undefined {
  return ctx.crossPay?.chains.find((c) => c.key === key) ?? ctx.crossChain.chains.find((c) => c.key === key);
}

/**
 * One step of a cross-chain payment. Before the burn: wait for it, or cancel at expiry. After:
 * check the burn on the reserved chain, then Circle, then the relay on Arc.
 */
export async function stepCrossPay(ctx: Ctx, t: Transfer): Promise<StepResult> {
  const cp = await crossPaymentFor(ctx, t.id);
  if (!cp) throw new Error(`Cross-chain payment ${t.id} has no cross_payments row`);
  const chain = chainOf(ctx, cp.chain);
  if (!chain || !ctx.crossPay) return "wait"; // switched off after the burn; it resumes when it's back

  if (cp.phase === "awaiting_burn" || cp.phase === "cancelled") {
    if (t.status !== "cancelled" && t.expiresAt && t.expiresAt <= ctx.now()) {
      // A burn reported since this row was read wins: the next step picks it up.
      if (!(await cancelUnburned(ctx, cp))) return "wait";
      return { status: "cancelled", patch: { lastError: "No payment arrived within 30 minutes" } };
    }
    // Checked and still waiting: move to the back of the reservation queue.
    await ctx.db.update(transfers).set({ updatedAt: ctx.now() }).where(eq(transfers.id, t.id));
    return "wait";
  }

  if (cp.phase === "burned") {
    const { reader, network } = ctx.crossChain;
    const receipt = await reader.burnReceipt(chain, cp.burnTxHash as Hex);
    if (!receipt) {
      // Not mined (yet). A transaction the chain has seen keeps us waiting, however long it takes; only
      // one replaced at its nonce, or never seen at all after the grace, may have left nothing behind.
      const sentNonce = cp.burnNonce ?? (await reader.transactionNonce(chain, cp.burnTxHash as Hex));
      if (sentNonce !== null && cp.burnNonce === null) await saveCross(ctx, cp, { burnNonce: sentNonce });
      const replaced = sentNonce !== null && (await reader.pendingNonce(chain, t.payerAddress as Address)) > sentNonce;
      const unseen = sentNonce === null && ctx.now().getTime() - cp.updatedAt.getTime() > BURN_SEEN_GRACE_MS;
      if (!replaced && !unseen) return "wait";
      // Before telling the payer nothing left their wallet, look for this burn under another hash
      // (a wallet speed-up replaces the hash; a lagging node may not have the receipt yet).
      const found = await matchingBurn(ctx, chain, t, cp);
      if (found && found.toLowerCase() !== cp.burnTxHash?.toLowerCase()) {
        await saveCross(ctx, cp, { burnTxHash: found.toLowerCase(), burnNonce: null, lastError: null });
        return "wait";
      }
      if (found) return "wait";
      return reopen(ctx, cp, "replaced");
    }
    if (receipt.status === "reverted") return reopen(ctx, cp, "reverted");
    const want = { crossPay: ctx.crossPay.address, burnAmount: BigInt(cp.burnAmount), usdc: chain.usdc[network], hookHash: cp.hookHash };
    if (!receipt.burns.some((b) => checkBurn(b, want) === "ok")) {
      await saveCross(ctx, cp, { phase: "refunded", lastError: "burn mismatch" });
      return { status: "failed", patch: { lastError: CROSS_TEXT.mismatch() } };
    }
    await saveCross(ctx, cp, { phase: "attesting", burnNonce: receipt.nonce, lastError: null });
    return "wait";
  }

  return stepAfterBurn(ctx, t, cp, chain);
}

/** After this long without Circle's attestation, the page says so and the logs flag it. */
export const ATTENTION_AFTER_MS = 30 * 60_000;
/** Failed relays before the payment is flagged (it keeps retrying). */
export const RELAY_ATTENTION_AFTER = 3;

const landed = (tx: { status: string; rawState?: string | null; txHash?: string | null }) =>
  tx.status === "complete" || (tx.status === "pending" && tx.rawState === "CONFIRMED" && Boolean(tx.txHash));

/**
 * After the burn: wait for Circle's attestation, relay it from the treasury, and read the outcome
 * from SplitsCrossPay's own events (anyone may have relayed). Paid goes on to the receipt check;
 * a refund ends the payment and says where the money went.
 */
async function stepAfterBurn(ctx: Ctx, t: Transfer, cp: CrossPayment, chain: SourceChain): Promise<StepResult> {
  const crossPay = ctx.crossPay!.address;

  // Read only once this burn's own nonce is known: an event naming this payment's ref and payer
  // proves nothing, since anyone can burn with a hook that copies them.
  const outcome = cp.nonce
    ? await ctx.chain.crossPayOutcome(crossPay, ctx.crossChain.cctp.messageTransmitter, cp.nonce as Hex, t.fromBlock ?? 0n)
    : null;
  if (outcome?.kind === "paid") {
    await saveCross(ctx, cp, { phase: "paid", relayTxHash: outcome.txHash, feeBack: outcome.feeBack.toString(), lastError: null });
    return { status: "verifying", patch: { txHash: outcome.txHash } };
  }
  if (outcome?.kind === "refunded") {
    await saveCross(ctx, cp, { phase: outcome.owed ? "owed" : "refunded", relayTxHash: outcome.txHash, refundAmount: outcome.amount.toString() });
    const text = outcome.owed ? CROSS_TEXT.owed() : CROSS_TEXT.refunded(outcome.amount, t.payerAddress);
    return { status: "failed", patch: { txHash: outcome.txHash, lastError: text } };
  }

  if (cp.phase === "attesting") {
    let msg;
    try {
      // The burn transaction may hold other burns; ours is the one carrying this payment's hook.
      msg = await ctx.crossChain.iris.message(chain.domain, cp.burnTxHash as Hex, (m) => keccak256(parseBurnMessage(m).hookData) === cp.hookHash.toLowerCase());
    } catch (err) {
      console.error(`[cross-pay] ${t.id}: Iris`, err);
      return attentionIfLate(ctx, t, cp);
    }
    if (msg.status !== "complete") return attentionIfLate(ctx, t, cp, msg.status === "pending" && msg.delayReason !== null);
    const m = parseBurnMessage(msg.message);
    if (m.mintRecipient.toLowerCase() !== crossPay.toLowerCase() || m.destinationCaller.toLowerCase() !== crossPay.toLowerCase()) {
      throw new Error(`Attested message for ${t.id} isn't addressed to SplitsCrossPay; not relaying`);
    }
    const slow = cp.fast && hexToNumber(slice(msg.message, 144, 148)) > FAST;
    await saveCross(ctx, cp, { phase: "relaying", message: msg.message, attestation: msg.attestation, nonce: nonceOf(msg.message), slowRoute: cp.slowRoute || slow, lastError: null });
    return "wait";
  }

  // relaying
  if (await ctx.chain.cctpNonceUsed(ctx.crossChain.cctp.messageTransmitter, cp.nonce as Hex)) return "wait"; // minted; the outcome settles it next
  if (cp.relayProviderTx) {
    const relay = await ctx.wallets.getTx(cp.relayProviderTx);
    if (relay.status !== "failed") return "wait";
    const error = relay.error ?? relay.rawState ?? "relay failed";
    if (/expired/i.test(error)) {
      // A Fast attestation expires if it isn't minted in time; Circle re-attests on request. If it
      // won't, stay here: the failure counts toward the attention flag like any other.
      const reattested = await ctx.crossChain.iris.reattest(cp.nonce as Hex).then(
        () => true,
        (err) => {
          console.error(`[cross-pay] ${t.id}: reattest`, err);
          return false;
        },
      );
      if (reattested) {
        await saveCross(ctx, cp, { phase: "attesting", relayProviderTx: null, message: null, attestation: null, attempts: cp.attempts + 1, lastError: "re-attesting" });
        return "wait";
      }
    }
    const attempts = cp.attempts + 1;
    const flag = attempts >= RELAY_ATTENTION_AFTER && !cp.attentionAt;
    if (flag) console.error(`[cross-pay] needs attention: ${t.id} relay failed ${attempts} times (${error}); retrying`);
    await saveCross(ctx, cp, { relayProviderTx: null, attempts, lastError: error, attentionAt: flag ? ctx.now() : cp.attentionAt });
    return "wait";
  }
  const { providerTxId } = await ctx.wallets.execute({
    walletId: ctx.treasuryWalletId,
    contract: crossPay,
    callData: encodeFunctionData({ abi: crossPayAbi, functionName: "relay", args: [cp.message as Hex, cp.attestation as Hex] }),
    idempotencyKey: deterministicUuid(`cross-relay:${t.id}:${cp.attempts}`),
    refId: `cross-pay:${t.id}`,
  });
  await saveCross(ctx, cp, { relayProviderTx: providerTxId });
  return "wait";
}

/**
 * Still waiting on Circle. The 30-minute clock runs from the last phase change, so these marks
 * don't touch updatedAt. A Fast burn Circle is holding for its fee is marked as the slow route.
 */
async function attentionIfLate(ctx: Ctx, t: Transfer, cp: CrossPayment, slow = false): Promise<StepResult> {
  const patch: Partial<CrossPayment> = {};
  if (slow && cp.fast && !cp.slowRoute) patch.slowRoute = true;
  if (!cp.attentionAt && ctx.now().getTime() - cp.updatedAt.getTime() > ATTENTION_AFTER_MS) {
    patch.attentionAt = ctx.now();
    console.error(`[cross-pay] needs attention: ${t.id} has no attestation from Circle after 30 minutes (burn ${cp.burnTxHash})`);
  }
  if (Object.keys(patch).length) await ctx.db.update(crossPayments).set(patch).where(eq(crossPayments.transferId, cp.transferId));
  return "wait";
}

/** How long after a reservation the late scan keeps looking for a burn nobody reported. */
export const LATE_BURN_WINDOW_MS = 2 * 3_600_000;
const LATE_BURN_EVERY_MS = 30_000;

/**
 * Reservations whose payer burned but never reported the hash (the page closed). Each is checked
 * at most every 30 seconds, for 2 hours, on its own chain, from the block at reservation.
 */
export async function findLateBurns(ctx: Ctx, limit: number): Promise<number> {
  const crossPay = ctx.crossPay;
  if (!crossPay) return 0;
  const since = new Date(ctx.now().getTime() - LATE_BURN_WINDOW_MS);
  const checkedBefore = new Date(ctx.now().getTime() - LATE_BURN_EVERY_MS);
  const rows = await ctx.db
    .select({ t: transfers, cp: crossPayments })
    .from(crossPayments)
    .innerJoin(transfers, eq(transfers.id, crossPayments.transferId))
    .where(
      and(
        inArray(crossPayments.phase, ["awaiting_burn", "cancelled"]),
        isNull(crossPayments.burnTxHash),
        gt(crossPayments.createdAt, since),
        lt(crossPayments.updatedAt, checkedBefore),
      ),
    )
    .orderBy(asc(crossPayments.updatedAt))
    .limit(limit);
  let found = 0;
  for (const { t, cp } of rows) {
    const chain = crossPay.chains.find((c) => c.key === cp.chain);
    let hash: Hex | null = null;
    if (chain) {
      try {
        const want = { crossPay: crossPay.address, burnAmount: BigInt(cp.burnAmount), usdc: chain.usdc[ctx.crossChain.network], hookHash: cp.hookHash };
        const burns = await ctx.crossChain.reader.burnsFrom(chain, t.payerAddress as Address, cp.sourceFromBlock);
        hash = burns.find((b) => checkBurn(b.burn, want) === "ok")?.txHash ?? null;
      } catch (err) {
        console.error(`[late burns] ${t.id}`, err);
      }
    }
    if (!hash) {
      // Checked: rotate to the back so the next sweep looks at others first.
      await ctx.db.update(crossPayments).set({ updatedAt: ctx.now() }).where(eq(crossPayments.transferId, cp.transferId));
      continue;
    }
    const moved = await ctx.db
      .update(crossPayments)
      .set({ burnTxHash: hash.toLowerCase(), phase: "burned", lastError: null, updatedAt: ctx.now() })
      .where(and(eq(crossPayments.transferId, cp.transferId), isNull(crossPayments.burnTxHash)))
      .returning({ id: crossPayments.transferId });
    if (moved.length) {
      await ctx.db.update(transfers).set({ status: "sending", updatedAt: ctx.now() }).where(eq(transfers.id, t.id));
      found += 1;
    }
  }
  return found;
}

/**
 * Cancels a reservation only if nothing has been burned for it since `cp` was read: a burn reported
 * in between (by the page or the late scan) is never wiped out. Returns whether it cancelled.
 */
export async function cancelUnburned(ctx: Ctx, cp: CrossPayment): Promise<boolean> {
  const done = await ctx.db
    .update(crossPayments)
    .set({ phase: "cancelled", updatedAt: ctx.now() })
    .where(and(eq(crossPayments.transferId, cp.transferId), eq(crossPayments.phase, "awaiting_burn"), isNull(crossPayments.burnTxHash)))
    .returning({ id: crossPayments.transferId });
  return done.length > 0;
}

/** The payer's burn for this reservation on its chain, under any hash; null if there is none. */
async function matchingBurn(ctx: Ctx, chain: SourceChain, t: Transfer, cp: CrossPayment): Promise<Hex | null> {
  const want = { crossPay: ctx.crossPay!.address, burnAmount: BigInt(cp.burnAmount), usdc: chain.usdc[ctx.crossChain.network], hookHash: cp.hookHash };
  try {
    const burns = await ctx.crossChain.reader.burnsFrom(chain, t.payerAddress as Address, cp.sourceFromBlock);
    return burns.find((b) => checkBurn(b.burn, want) === "ok")?.txHash ?? null;
  } catch (err) {
    console.error(`[cross-pay] ${t.id}: looking for the burn`, err);
    return null;
  }
}

const STRAY_WINDOW_MS = 2 * 3_600_000;
const STRAY_EVERY_MS = 30_000;

/**
 * Burns to SplitsCrossPay by a payer that no payment is tracking: a second burn for the same link
 * (two tabs, a retry), or one that didn't match its link. Nothing would relay them, so their USDC
 * would wait in CCTP. Relaying them from the treasury lets the contract decide: the link's ref is
 * already used (or the hook doesn't pay), so it refunds the payer on Arc. Checked for 2 hours after
 * each reservation, at most every 30 seconds. Returns how many it relayed.
 */
export async function relayStrayBurns(ctx: Ctx, limit: number): Promise<number> {
  const crossPay = ctx.crossPay;
  if (!crossPay) return 0;
  const since = new Date(ctx.now().getTime() - STRAY_WINDOW_MS);
  const checkedBefore = new Date(ctx.now().getTime() - STRAY_EVERY_MS);
  const rows = await ctx.db
    .select({ t: transfers, cp: crossPayments })
    .from(crossPayments)
    .innerJoin(transfers, eq(transfers.id, crossPayments.transferId))
    .where(
      and(
        inArray(crossPayments.phase, ["paid", "refunded", "owed"]),
        gt(crossPayments.createdAt, since),
        lt(crossPayments.updatedAt, checkedBefore),
      ),
    )
    .orderBy(asc(crossPayments.updatedAt))
    .limit(limit);
  let relayed = 0;
  for (const { t, cp } of rows) {
    await ctx.db.update(crossPayments).set({ updatedAt: ctx.now() }).where(eq(crossPayments.transferId, cp.transferId));
    const chain = crossPay.chains.find((c) => c.key === cp.chain);
    if (!chain) continue;
    // The tracked burn was relayed already, unless it was the one that didn't match its link.
    const tracked = cp.lastError === "burn mismatch" ? null : cp.burnTxHash?.toLowerCase();
    try {
      const burns = await ctx.crossChain.reader.burnsFrom(chain, t.payerAddress as Address, cp.sourceFromBlock);
      for (const { txHash, burn } of burns) {
        const ours = burn.mintRecipient.toLowerCase() === crossPay.address.toLowerCase() && burn.destinationCaller.toLowerCase() === crossPay.address.toLowerCase();
        if (!ours || txHash.toLowerCase() === tracked) continue;
        const msg = await ctx.crossChain.iris.message(chain.domain, txHash);
        if (msg.status !== "complete") continue;
        if (await ctx.chain.cctpNonceUsed(ctx.crossChain.cctp.messageTransmitter, nonceOf(msg.message))) continue;
        await ctx.wallets.execute({
          walletId: ctx.treasuryWalletId,
          contract: crossPay.address,
          callData: encodeFunctionData({ abi: crossPayAbi, functionName: "relay", args: [msg.message, msg.attestation] }),
          idempotencyKey: deterministicUuid(`cross-stray:${txHash.toLowerCase()}`),
          refId: `cross-pay:${t.id}:stray`,
        });
        console.error(`[cross-pay] relayed stray burn ${txHash} on ${chain.name} for ${t.id}; SplitsCrossPay refunds it to the payer`);
        relayed++;
      }
    } catch (err) {
      console.error(`[cross-pay] ${t.id}: stray burns`, err);
    }
  }
  return relayed;
}
