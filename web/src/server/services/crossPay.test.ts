import { eq } from "drizzle-orm";
import { encodeFunctionData, erc20Abi, getAddress, keccak256, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { encodeDepositForBurnWithHook, encodeHook } from "../crosschain/cctp";
import { CCTP, SOURCE_CHAINS } from "../crosschain/chains";
import { crossPayAbi } from "../crosschain/crossPayAbi";
import type { Ctx } from "../context";
import { transfers } from "../db/schema";
import { testCtx } from "../testing";
import { CROSS_TEXT, crossMessage } from "./crossMessages";
import { cancelUnburned, crossPaymentFor, prepareCrossPayment, relayStrayBurns, submitCrossBurn } from "./crossPay";
import { sweep } from "./sweeper";
import { advanceTransfer, routerLegs } from "./transfers";
import { checkVisitorList } from "./visitorPayments";

const PAYER = getAddress("0x00000000000000000000000000000000000000aa");
const visitor = { keyHash: "v".repeat(64), ip: null };
const TWO = "0x00000000000000000000000000000000000000f1, 6\n0x00000000000000000000000000000000000000f2, 4";

type Prepared = Awaited<ReturnType<typeof prepareCrossPayment>>;
type T = Awaited<ReturnType<typeof testCtx>>;

/** A visitor's checked list, prepared for paying from `chain` (fees on, as on the live site). */
async function prepared(t: T, opts: { text?: string; chain?: string } = {}) {
  const check = await checkVisitorList(t.ctx, visitor, { mode: "each", text: opts.text ?? TWO, label: "rent" });
  return prepareCrossPayment(t.ctx, visitor, { draftId: check.draft!.id, draftHash: check.draft!.hash, payer: PAYER, chain: opts.chain ?? "base" });
}

/** A 2-person list ($6 + $4) prepared for paying from Base. */
export async function preparedFromBase(opts: { env?: Record<string, string>; chain?: string } = {}) {
  const t = await testCtx({ FEE_BPS: "150", ...opts.env });
  const p = await prepared(t, { chain: opts.chain });
  return { ...t, p };
}

/** The visitor's wallet does what the prepared call says, on the simulated Base. */
export function payerBurns(arc: T["arc"], p: Prepared, fund = BigInt(p.call.burnAmount)) {
  const chain = SOURCE_CHAINS.base;
  arc.fundSource("base", PAYER, fund);
  arc.sourceCall("base", PAYER, chain.usdc.testnet, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [p.call.tokenMessenger, BigInt(p.call.burnAmount)] }));
  return arc.sourceCall("base", PAYER, p.call.tokenMessenger, p.call.data);
}

describe("preparing a cross-chain payment", () => {
  it("reserves the list and returns the exact burn: split + fee + Circle's fee at its most", async () => {
    const { p } = await preparedFromBase();
    // $10 + 1.5% = $10.15; Circle's 1 bps of that, rounded up (1,015 units), plus 20%: 1,218.
    expect(p.cost).toEqual({ amount: "10.00", fee: "0.15", circleMax: "0.001218", total: "10.151218", fast: true });
    expect(p.call).toMatchObject({ chainId: 84532, usdc: SOURCE_CHAINS.base.usdc.testnet, tokenMessenger: CCTP.testnet.tokenMessenger, burnAmount: "10151218" });
    expect(p.transfer).toMatchObject({ funding: "cross_chain", status: "awaiting_wallet", payerAddress: PAYER });
    expect(p.cross).toMatchObject({ chain: "base", phase: "awaiting_burn", fast: true, hookHash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
  });

  it("refuses a chain that isn't switched on", async () => {
    await expect(preparedFromBase({ env: { CROSS_PAY_CHAINS: "base" }, chain: "matic" })).rejects.toThrow("Payments from Polygon are paused right now. Try another chain.");
  });

  it("refuses when cross-chain pay is off", async () => {
    const t = await testCtx();
    await expect(prepared({ ...t, ctx: { ...t.ctx, crossPay: null } })).rejects.toThrow("Payments from Base are paused right now. Try another chain.");
  });

  it("refuses when Circle's fee can't be read", async () => {
    const t = await testCtx();
    t.arc.irisDown = true;
    await expect(prepared(t)).rejects.toThrow("We couldn't get Circle's fee just now. Try again in a minute.");
  });

  it("takes the standard route when Circle's Fast allowance is too low", async () => {
    const t = await testCtx();
    t.arc.fastAllowanceUnits = 1_000_000n;
    const p = await prepared(t);
    expect(p.cost.fast).toBe(false);
    expect(p.cross.fast).toBe(false);
  });

  it("refuses less than $1", async () => {
    const t = await testCtx();
    await expect(prepared(t, { text: "0x00000000000000000000000000000000000000f1, 0.5" })).rejects.toThrow(/at least \$1/);
  });
});

describe("reporting the burn", () => {
  it("records the hash once, moves the payment into transit, and shows Circle's wait", async () => {
    const { ctx, arc, p } = await preparedFromBase();
    const hash = payerBurns(arc, p);
    const t = await submitCrossBurn(ctx, p.transfer.visitorToken!, hash);
    expect(t.status).toBe("sending");
    const cp = (await crossPaymentFor(ctx, t.id))!;
    expect(cp).toMatchObject({ phase: "burned", burnTxHash: hash.toLowerCase() });
    expect(crossMessage(t, cp, "Base").text).toBe(CROSS_TEXT.confirming("Base"));
    // Repeating the same hash is harmless; a different one is refused.
    await expect(submitCrossBurn(ctx, p.transfer.visitorToken!, hash)).resolves.toMatchObject({ id: t.id });
    await expect(submitCrossBurn(ctx, p.transfer.visitorToken!, keccak256("0x01"))).rejects.toThrow(/already has a transaction/);
  });

  it("refuses a burn report for a payment paid on Arc", async () => {
    const { ctx, p } = await preparedFromBase();
    await ctx.db.update(transfers).set({ funding: "own_wallet" }).where(eq(transfers.id, p.transfer.id));
    await expect(submitCrossBurn(ctx, p.transfer.visitorToken!, keccak256("0x02") as Hex)).rejects.toThrow(/isn't paid from another chain/);
  });
});

/** The sweeper's work on one payment, a few times over, with time passing. */
async function drive(ctx: Ctx, clock: { advance(ms: number): void }, id: string, rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    await advanceTransfer(ctx, id);
    clock.advance(6_000);
  }
  return { t: (await ctx.db.select().from(transfers).where(eq(transfers.id, id)))[0]!, cp: (await crossPaymentFor(ctx, id))! };
}

/** A burn from the payer's wallet on Base that the visitor's page didn't build (a hand-made transaction). */
function handBurn(arc: T["arc"], ctx: Ctx, amount: bigint, hookData: Hex) {
  const chain = SOURCE_CHAINS.base;
  arc.fundSource("base", PAYER, amount);
  arc.sourceCall("base", PAYER, chain.usdc.testnet, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CCTP.testnet.tokenMessenger, amount] }));
  return arc.sourceCall(
    "base",
    PAYER,
    CCTP.testnet.tokenMessenger,
    encodeDepositForBurnWithHook({ amount, burnToken: chain.usdc.testnet, maxFee: 2_000n, fast: true, hookData, crossPay: ctx.crossPay!.address }),
  );
}

describe("checking the burn", () => {
  it("accepts the burn the draft asked for and moves on to Circle", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    arc.irisHold = "pending";
    await submitCrossBurn(ctx, p.transfer.visitorToken!, payerBurns(arc, p));
    const { cp } = await drive(ctx, clock, p.transfer.id, 1);
    expect(cp.phase).toBe("attesting");
  });

  it("goes back to waiting when the burn reverted on the source chain", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    const hash = payerBurns(arc, p, 1n); // funded short: the burn reverts, nothing moves
    await submitCrossBurn(ctx, p.transfer.visitorToken!, hash);
    const { t, cp } = await drive(ctx, clock, p.transfer.id, 1);
    expect(t.status).toBe("awaiting_wallet");
    expect(cp).toMatchObject({ phase: "awaiting_burn", burnTxHash: null, lastError: "reverted" });
    expect(crossMessage(t, cp, "Base").text).toBe(CROSS_TEXT.burnReverted("Base"));
  });

  it("goes back to waiting when the burn was replaced in the wallet", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    const dropped = arc.dropSourceTx("base", PAYER, 0);
    await submitCrossBurn(ctx, p.transfer.visitorToken!, dropped);
    const { t, cp } = await drive(ctx, clock, p.transfer.id, 1);
    expect(cp).toMatchObject({ phase: "awaiting_burn", lastError: "replaced" });
    expect(crossMessage(t, cp, "Base").text).toBe(CROSS_TEXT.burnReplaced("Base"));
  });

  it("waits for a hash the chain hasn't seen yet, then gives up after the grace", async () => {
    const { ctx, clock, p } = await preparedFromBase();
    await submitCrossBurn(ctx, p.transfer.visitorToken!, keccak256("0xabcd"));
    expect((await drive(ctx, clock, p.transfer.id, 2)).cp.phase).toBe("burned");
    clock.advance(11 * 60_000);
    expect((await drive(ctx, clock, p.transfer.id, 1)).cp).toMatchObject({ phase: "awaiting_burn", lastError: "replaced" });
  });

  it("ignores a burn reported from another chain", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    // A real transaction on Arbitrum: its hash is unknown on Base, so it never settles this draft.
    const arb = arc.sourceCall("arb", PAYER, SOURCE_CHAINS.arb.usdc.testnet, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [p.call.tokenMessenger, 1n] }));
    await submitCrossBurn(ctx, p.transfer.visitorToken!, arb);
    const { t, cp } = await drive(ctx, clock, p.transfer.id, 2);
    expect(t.status).not.toBe("settled");
    expect(cp.phase).toBe("burned");
  });

  it("refuses a burn whose hook doesn't match the draft", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    const hash = handBurn(arc, ctx, BigInt(p.call.burnAmount), encodeHook([], 1n, p.transfer.ref as Hex, PAYER));
    await submitCrossBurn(ctx, p.transfer.visitorToken!, hash);
    const { t } = await drive(ctx, clock, p.transfer.id, 2);
    expect(t.status).toBe("failed");
    expect(t.lastError).toBe("That transaction isn't the payment this link set up. Flagged for review.");
  });

  it("refuses a burn for less than the draft", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    const hook = encodeHook(routerLegs(p.transfer), 10_150_000n, p.transfer.ref as Hex, PAYER);
    const hash = handBurn(arc, ctx, BigInt(p.call.burnAmount) - 1n, hook);
    await submitCrossBurn(ctx, p.transfer.visitorToken!, hash);
    const { t } = await drive(ctx, clock, p.transfer.id, 2);
    expect(t.status).toBe("failed");
    expect(t.lastError).toBe("That transaction isn't the payment this link set up. Flagged for review.");
  });

  it("a larger burn still pays exactly and returns the rest", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    const hook = encodeHook(routerLegs(p.transfer), 10_150_000n, p.transfer.ref as Hex, PAYER);
    const hash = handBurn(arc, ctx, BigInt(p.call.burnAmount) + 5_000_000n, hook);
    await submitCrossBurn(ctx, p.transfer.visitorToken!, hash);
    const { t } = await drive(ctx, clock, p.transfer.id, 8);
    expect(t.status).toBe("settled");
    expect(await ctx.chain.usdcBalance(getAddress("0x00000000000000000000000000000000000000f1"))).toBe(6_000_000n);
  });
});

describe("after the burn", () => {
  async function burned(opts: Parameters<typeof preparedFromBase>[0] = {}) {
    const x = await preparedFromBase(opts);
    await submitCrossBurn(x.ctx, x.p.transfer.visitorToken!, payerBurns(x.arc, x.p));
    return x;
  }
  const F1 = getAddress("0x00000000000000000000000000000000000000f1");
  const F2 = getAddress("0x00000000000000000000000000000000000000f2");

  it("pays every recipient exactly, returns the unused fee, and settles with the relay as the receipt", async () => {
    const { ctx, clock, p } = await burned();
    const { t, cp } = await drive(ctx, clock, p.transfer.id, 8);
    expect(t.status).toBe("settled");
    expect(cp.phase).toBe("paid");
    expect(t.txHash).toBe(cp.relayTxHash);
    expect(await ctx.chain.usdcBalance(F1)).toBe(6_000_000n);
    expect(await ctx.chain.usdcBalance(F2)).toBe(4_000_000n);
    expect(await ctx.chain.usdcBalance(PAYER)).toBe(BigInt(cp.feeBack!));
    expect(BigInt(cp.feeBack!)).toBeGreaterThan(0n);
    expect(crossMessage(t, cp, "Base").text).toMatch(/^Paid on Arc\. \$0\.000\d+ unused fee went back to your Arc address\.$/);
  });

  it("keeps waiting for Circle, then says so after 30 minutes", async () => {
    const { ctx, arc, clock, p } = await burned();
    arc.irisHold = "pending";
    expect((await drive(ctx, clock, p.transfer.id, 3)).cp.attentionAt).toBeNull();
    clock.advance(31 * 60_000);
    const { t, cp } = await drive(ctx, clock, p.transfer.id, 1);
    expect(cp.attentionAt).not.toBeNull();
    expect(crossMessage(t, cp, "Base").text).toBe(CROSS_TEXT.attention());
    arc.irisHold = null;
    expect((await drive(ctx, clock, p.transfer.id, 6)).t.status).toBe("settled");
  });

  it("keeps going when Iris is down", async () => {
    const { ctx, arc, clock, p } = await burned();
    arc.irisDown = true;
    expect((await drive(ctx, clock, p.transfer.id, 3)).cp.phase).toBe("attesting");
    arc.irisDown = false;
    expect((await drive(ctx, clock, p.transfer.id, 6)).t.status).toBe("settled");
  });

  it("marks the slow route when Circle's fee rose past the maximum", async () => {
    const x = await preparedFromBase();
    x.arc.irisFeeBps = 50; // far above what maxFee allowed
    await submitCrossBurn(x.ctx, x.p.transfer.visitorToken!, payerBurns(x.arc, x.p));
    x.arc.irisHold = "pending";
    const { t, cp } = await drive(x.ctx, x.clock, x.p.transfer.id, 2);
    expect(cp.slowRoute).toBe(true);
    expect(crossMessage(t, cp, "Base").text).toBe(CROSS_TEXT.slowRoute());
  });

  it("a reverted relay retries and then needs attention", async () => {
    const { ctx, arc, clock, p } = await burned();
    arc.relayFailuresLeft = 4;
    const mid = await drive(ctx, clock, p.transfer.id, 12); // each failed relay takes three sweeps: send, pending, failed
    expect(mid.t.status).not.toBe("settled");
    expect(mid.cp.phase).toBe("relaying");
    expect(mid.cp.attentionAt).not.toBeNull();
    expect(crossMessage(mid.t, mid.cp, "Base").text).toBe(CROSS_TEXT.arriving());
    expect((await drive(ctx, clock, p.transfer.id, 8)).t.status).toBe("settled");
  });

  it("re-attests an expired fast message and relays again", async () => {
    const { ctx, arc, clock, p } = await burned();
    arc.expireNextAttestation = true;
    expect((await drive(ctx, clock, p.transfer.id, 10)).t.status).toBe("settled");
  });

  it("settles when someone else relayed first", async () => {
    const { ctx, arc, clock, p } = await burned();
    const msg = await arc.iris.message(6, (await crossPaymentFor(ctx, p.transfer.id))!.burnTxHash as Hex);
    if (msg.status !== "complete") throw new Error("expected an attestation");
    arc.callFrom(getAddress("0x00000000000000000000000000000000000000cc"), ctx.crossPay!.address, encodeFunctionData({ abi: crossPayAbi, functionName: "relay", args: [msg.message, msg.attestation] }));
    expect((await drive(ctx, clock, p.transfer.id, 6)).t.status).toBe("settled");
  });

  it("refunds everything when a recipient can't receive, and says where it went", async () => {
    const { ctx, arc, clock, p } = await burned();
    arc.setBlocked(F2, true);
    const { t, cp } = await drive(ctx, clock, p.transfer.id, 8);
    expect(t.status).toBe("failed");
    expect(cp.phase).toBe("refunded");
    expect(await ctx.chain.usdcBalance(F1)).toBe(0n);
    expect(await ctx.chain.usdcBalance(PAYER)).toBe(BigInt(cp.refundAmount!));
    expect(t.lastError).toBe(CROSS_TEXT.refunded(BigInt(cp.refundAmount!), PAYER));
  });

  it("waits for SplitsCrossPay's events after the mint instead of guessing the outcome", async () => {
    const { ctx, arc, clock, p } = await burned();
    arc.setBlocked(F2, true); // the relay will refund
    arc.crossOutcomeLag = 30; // the node shows the mint before it indexes the events
    const mid = await drive(ctx, clock, p.transfer.id, 8);
    expect(mid.t.status).toBe("sending");
    arc.crossOutcomeLag = 0;
    const { t, cp } = await drive(ctx, clock, p.transfer.id, 2);
    expect(t.status).toBe("failed");
    expect(cp.phase).toBe("refunded");
  });

  it("holds the refund as owed when even the refund can't be sent", async () => {
    const { ctx, arc, clock, p } = await burned();
    arc.setBlocked(F2, true);
    arc.setBlocked(PAYER, true);
    const { t, cp } = await drive(ctx, clock, p.transfer.id, 8);
    expect(cp.phase).toBe("owed");
    expect(t.lastError).toBe(CROSS_TEXT.owed());
  });

  it("isn't fooled by another burner reusing this payment's public ref", async () => {
    const { ctx, arc, clock, p } = await burned();
    arc.irisHold = "pending";
    // A stranger burns with this payment's ref, paying themselves; it lands first.
    const stranger = getAddress("0x00000000000000000000000000000000000000dd");
    const chain = SOURCE_CHAINS.base;
    const hook = encodeHook([{ recipient: stranger, fixedAmount: 10_000n, shareBps: 0, purpose: p.transfer.ref as Hex }], 10_000n, p.transfer.ref as Hex, stranger);
    arc.fundSource("base", stranger, 20_000n);
    arc.sourceCall("base", stranger, chain.usdc.testnet, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CCTP.testnet.tokenMessenger, 20_000n] }));
    const theirs = arc.sourceCall("base", stranger, CCTP.testnet.tokenMessenger, encodeDepositForBurnWithHook({ amount: 20_000n, burnToken: chain.usdc.testnet, maxFee: 2_000n, fast: true, hookData: hook, crossPay: ctx.crossPay!.address }));
    arc.irisHold = null;
    const msg = await arc.iris.message(6, theirs);
    if (msg.status !== "complete") throw new Error("expected an attestation");
    arc.callFrom(stranger, ctx.crossPay!.address, encodeFunctionData({ abi: crossPayAbi, functionName: "relay", args: [msg.message, msg.attestation] }));
    const { t } = await drive(ctx, clock, p.transfer.id, 8);
    expect(t.status).toBe("settled");
    expect(await ctx.chain.usdcBalance(F1)).toBe(6_000_000n);
  });
});

describe("a payer who closed the page", () => {
  it("is found by the late scan and paid", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    payerBurns(arc, p); // never reported
    clock.advance(31 * 60_000);
    await sweep(ctx);
    expect((await ctx.db.select().from(transfers).where(eq(transfers.id, p.transfer.id)))[0]!.status).toBe("cancelled");
    clock.advance(60_000);
    await sweep(ctx);
    const { t } = await drive(ctx, clock, p.transfer.id, 8);
    expect(t.status).toBe("settled");
  });

  it("stops looking after two hours", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    clock.advance(2 * 3_600_000 + 60_000);
    payerBurns(arc, p);
    await sweep(ctx);
    expect((await crossPaymentFor(ctx, p.transfer.id))!.phase).toBe("cancelled");
  });

  it("does not offer Pay again once a burn was reported", async () => {
    const { ctx, arc, p } = await preparedFromBase();
    await submitCrossBurn(ctx, p.transfer.visitorToken!, payerBurns(arc, p));
    const { visitorPaymentView } = await import("../views");
    const t = (await ctx.db.select().from(transfers).where(eq(transfers.id, p.transfer.id)))[0]!;
    const view = visitorPaymentView(ctx, t, null, (await crossPaymentFor(ctx, p.transfer.id))!);
    expect(view.cross?.canPay).toBe(false);
    expect(view.cross?.call).toBeNull();
  });
});

describe("never paying twice by mistake", () => {
  it("keeps waiting for a burn the chain has seen but not mined, however long it takes", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    const pending = arc.pendSourceTx("base", PAYER, 0);
    await submitCrossBurn(ctx, p.transfer.visitorToken!, pending);
    clock.advance(20 * 60_000);
    const { t, cp } = await drive(ctx, clock, p.transfer.id, 2);
    expect(cp.phase).toBe("burned");
    expect(t.status).toBe("sending");
  });

  it("follows the payment to its new hash when the wallet sped it up, instead of offering Pay again", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    const first = arc.dropSourceTx("base", PAYER, 0); // replaced at nonce 0…
    await submitCrossBurn(ctx, p.transfer.visitorToken!, first);
    const second = payerBurns(arc, p); // …by the same burn under another hash
    const { t, cp } = await drive(ctx, clock, p.transfer.id, 10);
    expect(cp.burnTxHash).toBe(second.toLowerCase());
    expect(t.status).toBe("settled");
  });

  it("relays a second burn for the same payment, so the payer gets it back on Arc", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    const firstHash = payerBurns(arc, p);
    payerBurns(arc, p); // paid twice from two tabs
    await submitCrossBurn(ctx, p.transfer.visitorToken!, firstHash);
    const { t, cp } = await drive(ctx, clock, p.transfer.id, 8);
    expect(t.status).toBe("settled");
    const before = await ctx.chain.usdcBalance(PAYER);
    clock.advance(60_000);
    expect(await relayStrayBurns(ctx, 10)).toBe(1);
    // The second burn came back whole, less only Circle's fee.
    expect((await ctx.chain.usdcBalance(PAYER)) - before).toBeGreaterThan(BigInt(p.call.burnAmount) - 5_000n);
    expect(BigInt(cp.feeBack!)).toBeGreaterThan(0n);
    expect(await relayStrayBurns(ctx, 10)).toBe(0);
  });

  it("relays a burn that didn't match the payment, so the contract refunds it", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    const hash = handBurn(arc, ctx, BigInt(p.call.burnAmount), encodeHook([], 1n, p.transfer.ref as Hex, PAYER));
    await submitCrossBurn(ctx, p.transfer.visitorToken!, hash);
    expect((await drive(ctx, clock, p.transfer.id, 2)).t.status).toBe("failed");
    clock.advance(60_000);
    expect(await relayStrayBurns(ctx, 10)).toBe(1);
    expect(await ctx.chain.usdcBalance(PAYER)).toBeGreaterThan(BigInt(p.call.burnAmount) - 5_000n);
  });

  it("never cancels a reservation whose burn was reported in the meantime", async () => {
    const { ctx, arc, p } = await preparedFromBase();
    const stale = (await crossPaymentFor(ctx, p.transfer.id))!; // read by a sweeper as awaiting_burn…
    await submitCrossBurn(ctx, p.transfer.visitorToken!, payerBurns(arc, p)); // …then the burn is reported
    expect(await cancelUnburned(ctx, stale)).toBe(false);
    expect((await crossPaymentFor(ctx, p.transfer.id))!.phase).toBe("burned");
  });

  it("keeps relaying, and flags it, when Circle won't re-attest an expired message", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    await submitCrossBurn(ctx, p.transfer.visitorToken!, payerBurns(arc, p));
    arc.expireNextAttestation = true;
    arc.reattestFails = true;
    const mid = await drive(ctx, clock, p.transfer.id, 14);
    expect(mid.cp.phase).toBe("relaying");
    expect(mid.cp.attentionAt).not.toBeNull();
    arc.reattestFails = false;
    expect((await drive(ctx, clock, p.transfer.id, 10)).t.status).toBe("settled");
  });

  it("keeps payments in flight moving while a chain is closed to new ones", async () => {
    const { ctx, arc, clock, p } = await preparedFromBase();
    await submitCrossBurn(ctx, p.transfer.visitorToken!, payerBurns(arc, p));
    const closed = { ...ctx, crossPay: { ...ctx.crossPay!, open: [] } };
    expect((await drive(closed, clock, p.transfer.id, 8)).t.status).toBe("settled");
    const t = await testCtx({ FEE_BPS: "150" });
    await expect(prepared({ ...t, ctx: { ...t.ctx, crossPay: { ...t.ctx.crossPay!, open: [] } } })).rejects.toThrow("Payments from Base are paused right now. Try another chain.");
  });
});
