import { eq } from "drizzle-orm";
import { encodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { splitsRouterAbi } from "../chain/abi";
import type { Ctx } from "../context";
import { notices, users } from "../db/schema";
import { AppError } from "../errors";
import type { PreviewArc } from "../preview/previewArc";
import { signedInUser, TEST_PIN, testCtx } from "../testing";
import { visitorPaymentView } from "../views";
import { checkPayout } from "./payouts";
import { receiptByToken, receiptLinks } from "./receipts";
import { advanceWithRules } from "./rules";
import { sweep } from "./sweeper";
import { confirmTransfer, getTransfer, quoteTransfer } from "./transfers";
import {
  checkVisitorList,
  emailVisitorReceipt,
  prepareVisitorPayment,
  submitVisitorPayment,
  visitorPaymentByToken,
  type PreparedPayment,
} from "./visitorPayments";

const me = getAddress("0x00000000000000000000000000000000000000e1");
const friend = getAddress("0x00000000000000000000000000000000000000e2");
const visitor = { keyHash: "f".repeat(64), ip: "203.0.113.7" };

async function code(p: Promise<unknown>) {
  try {
    await p;
    return "OK";
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
}

async function prepared(ctx: Ctx, text: string, email?: string) {
  const check = await checkVisitorList(ctx, visitor, { mode: "each", text, label: "gift" });
  expect(check.ready).toBe(true);
  return prepareVisitorPayment(ctx, visitor, { draftId: check.draft!.id, draftHash: check.draft!.hash, payer: me, email });
}

/** What the visitor's wallet does: approve the exact total, then pay the legs the server returned. */
function payFromWallet(arc: PreviewArc, p: PreparedPayment, sender: Address = me): Hex {
  const total = BigInt(p.transfer.amount) + BigInt(p.transfer.feeAmount);
  arc.callFrom(sender, arc.usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [arc.router, total] }));
  return arc.callFrom(
    sender,
    arc.router,
    encodeFunctionData({
      abi: splitsRouterAbi,
      functionName: "pay",
      args: [p.legs.map((l) => ({ ...l, fixedAmount: BigInt(l.fixedAmount) })), total, p.transfer.ref as Hex],
    }),
  );
}

async function drive(ctx: Ctx, id: string) {
  let t = await advanceWithRules(ctx, id);
  for (let i = 0; i < 10 && !["settled", "failed", "cancelled"].includes(t.status); i++) t = await advanceWithRules(ctx, id);
  return t;
}

describe("paying from your own wallet", () => {
  it("pays a mixed list from an outside wallet, then receipts and notices", async () => {
    const { ctx, arc } = await testCtx();
    arc.mint(me, 10_000_000n);
    const p = await prepared(ctx, `${friend}, 2\nsis@example.com, 3`);
    expect(p.transfer.status).toBe("awaiting_wallet");
    expect(p.balance).toBe("10000000");
    expect(p.allowance).toBe("0");
    expect(await receiptLinks(ctx, p.transfer)).toBeNull();

    const hash = payFromWallet(arc, p);
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, hash);
    const t = await drive(ctx, p.transfer.id);
    expect(t.status).toBe("settled");
    expect(await arc.chainReader.usdcBalance(friend)).toBe(2_000_000n);
    const links = await receiptLinks(ctx, t);
    expect(links).toHaveLength(2);
    const receipt = await receiptByToken(ctx, links![0]!);
    expect(receipt.from).toMatch(/^0x0000…00e1$/i);
    expect(receipt.fromAddress).toBe(me);
    const queued = await ctx.db.select().from(notices).where(eq(notices.transferId, t.id));
    expect(queued.map((n) => n.email)).toEqual(["sis@example.com"]);
  });

  it("a second submit with the same hash is a no-op, a different hash is refused", async () => {
    const { ctx, arc } = await testCtx();
    arc.mint(me, 10_000_000n);
    const p = await prepared(ctx, `${friend}, 2`);
    const hash = payFromWallet(arc, p);
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, hash);
    expect((await submitVisitorPayment(ctx, p.transfer.visitorToken!, hash)).txHash).toBe(hash);
    expect(await code(submitVisitorPayment(ctx, p.transfer.visitorToken!, `0x${"9".repeat(64)}`))).toBe("OTHER_TRANSACTION");
  });

  it("accepts the payer in any letter case", async () => {
    const { ctx, arc } = await testCtx();
    arc.mint(me, 10_000_000n);
    const check = await checkVisitorList(ctx, visitor, { mode: "each", text: `${friend}, 2`, label: "gift" });
    const p = await prepareVisitorPayment(ctx, visitor, {
      draftId: check.draft!.id,
      draftHash: check.draft!.hash,
      payer: me.toLowerCase() as Address,
    });
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, payFromWallet(arc, p));
    expect((await drive(ctx, p.transfer.id)).status).toBe("settled");
  });

  it("fails a payment sent from a different wallet", async () => {
    const { ctx, arc } = await testCtx();
    const other = getAddress("0x00000000000000000000000000000000000000e9");
    arc.mint(other, 10_000_000n);
    const p = await prepared(ctx, `${friend}, 2`);
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, payFromWallet(arc, p, other));
    const t = await drive(ctx, p.transfer.id);
    expect(t.status).toBe("failed");
    expect(t.lastError).toMatch(/does not match/);
    expect(await ctx.db.select().from(notices)).toHaveLength(0);
  });

  it("pays the fee on top, and fails a payment that leaves the fee out", async () => {
    const { ctx, arc } = await testCtx({ FEE_BPS: "150", FEE_MANY_BPS: "200" });
    arc.mint(me, 10_000_000n);
    const p = await prepared(ctx, `${friend}, 4`);
    expect(p.transfer.feeAmount).toBe("60000");
    expect(p.legs.at(-1)).toMatchObject({ recipient: ctx.fees.address, fixedAmount: "60000" });
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, payFromWallet(arc, p));
    expect((await drive(ctx, p.transfer.id)).status).toBe("settled");
    expect(await arc.chainReader.usdcBalance(me)).toBe(10_000_000n - 4_060_000n);

    const q = await prepared(ctx, `${friend}, 4`);
    const noFee = { ...q, legs: q.legs.slice(0, -1), transfer: { ...q.transfer, feeAmount: "0" } };
    await submitVisitorPayment(ctx, q.transfer.visitorToken!, payFromWallet(arc, noFee));
    expect((await drive(ctx, q.transfer.id)).status).toBe("failed");
  });

  it("settles on the visitor's own transaction when another wallet's hash was submitted", async () => {
    const { ctx, arc } = await testCtx();
    const other = getAddress("0x00000000000000000000000000000000000000e9");
    arc.mint(me, 10_000_000n);
    arc.mint(other, 10_000_000n);
    const p = await prepared(ctx, `${friend}, 2`);
    const mine = payFromWallet(arc, p); // the visitor's own payment
    const theirs = payFromWallet(arc, p, other); // same legs and ref, from someone else
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, theirs);
    const t = await drive(ctx, p.transfer.id);
    expect(t.status).toBe("settled");
    expect(t.txHash).toBe(mine);
  });

  it("settles when the wallet's second send reverted but the first landed", async () => {
    const { ctx, arc } = await testCtx();
    arc.mint(me, 10_000_000n);
    const p = await prepared(ctx, `${friend}, 2`);
    const first = payFromWallet(arc, p);
    const retry = payFromWallet(arc, p); // RefAlreadyUsed: reverts
    expect((await arc.chainReader.receipt(retry))?.status).toBe("reverted");
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, retry);
    const t = await drive(ctx, p.transfer.id);
    expect(t.status).toBe("settled");
    expect(t.txHash).toBe(first);
  });

  it("settles when the submitted hash never appears but the payment landed", async () => {
    const { ctx, arc } = await testCtx();
    arc.mint(me, 10_000_000n);
    const p = await prepared(ctx, `${friend}, 2`);
    const real = payFromWallet(arc, p);
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, `0x${"7".repeat(64)}`); // e.g. a sped-up or Safe hash
    const t = await drive(ctx, p.transfer.id);
    expect(t.status).toBe("settled");
    expect(t.txHash).toBe(real);
  });

  it("goes back to waiting when the send reverted, and says only the network fee was spent", async () => {
    const { ctx, arc } = await testCtx();
    const p = await prepared(ctx, `${friend}, 2`); // no USDC yet: the send reverts
    const reverted = payFromWallet(arc, p);
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, reverted);
    let t = await advanceWithRules(ctx, p.transfer.id);
    expect(t.status).toBe("awaiting_wallet");
    expect(t.txHash).toBeNull();
    expect(t.lastError).toBe("Arc reverted the send, so nobody was paid. Only Arc's network fee for the attempt left your wallet.");
    // The status page shows why while the payer tries again.
    expect(visitorPaymentView(ctx, t, null).error).toBe(t.lastError);
    arc.mint(me, 10_000_000n);
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, payFromWallet(arc, p));
    t = await drive(ctx, p.transfer.id);
    expect(t.status).toBe("settled");
  });

  it("gives up on a hash that never appears once the reservation is long gone", async () => {
    const { ctx, clock } = await testCtx();
    const p = await prepared(ctx, `${friend}, 2`);
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, `0x${"7".repeat(64)}`);
    expect((await advanceWithRules(ctx, p.transfer.id)).status).toBe("verifying");
    clock.advance(41 * 60_000);
    const t = await advanceWithRules(ctx, p.transfer.id);
    expect(t.status).toBe("cancelled");
    expect(t.txHash).toBeNull();
  });

  it("fails a payment whose legs differ from the checked list", async () => {
    const { ctx, arc } = await testCtx();
    arc.mint(me, 10_000_000n);
    const p = await prepared(ctx, `${friend}, 2`);
    const changed = { ...p, legs: [{ ...p.legs[0]!, fixedAmount: "1000000" }], transfer: { ...p.transfer, amount: "1000000" } };
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, payFromWallet(arc, changed));
    expect((await drive(ctx, p.transfer.id)).status).toBe("failed");
  });

  it("settles a payment whose page closed before reporting it", async () => {
    const { ctx, arc } = await testCtx();
    arc.mint(me, 10_000_000n);
    const p = await prepared(ctx, `${friend}, 2`);
    payFromWallet(arc, p);
    await sweep(ctx);
    await sweep(ctx);
    expect((await visitorPaymentByToken(ctx, p.transfer.visitorToken!)).status).toBe("settled");
  });

  it("cancels an unpaid reservation after 30 minutes, then still settles it if it lands late", async () => {
    const { ctx, arc, clock } = await testCtx();
    arc.mint(me, 10_000_000n);
    const p = await prepared(ctx, `${friend}, 2`);
    clock.advance(31 * 60_000);
    await sweep(ctx);
    expect((await visitorPaymentByToken(ctx, p.transfer.visitorToken!)).status).toBe("cancelled");
    payFromWallet(arc, p);
    // Cancelled reservations are re-checked every 30 seconds.
    clock.advance(31_000);
    await sweep(ctx);
    await sweep(ctx);
    expect((await visitorPaymentByToken(ctx, p.transfer.visitorToken!)).status).toBe("settled");
  });

  it("reserves against the visitor's daily limit", async () => {
    const { ctx } = await testCtx({ VISITOR_SEND_LIMIT_DAILY_USDC: "5" });
    await prepared(ctx, `${friend}, 3`);
    const check = await checkVisitorList(ctx, visitor, { mode: "each", text: `${friend}, 3`, label: "gift" });
    expect(await code(prepareVisitorPayment(ctx, visitor, { draftId: check.draft!.id, draftHash: check.draft!.hash, payer: me }))).toBe("SEND_LIMIT");
  });

  it("two reservations racing each other cannot both pass", async () => {
    const { ctx } = await testCtx({ VISITOR_SEND_LIMIT_DAILY_USDC: "5" });
    const a = await checkVisitorList(ctx, visitor, { mode: "each", text: `${friend}, 3`, label: "gift" });
    const b = await checkVisitorList(ctx, visitor, { mode: "each", text: `${friend}, 3`, label: "gift" });
    const results = await Promise.all([
      code(prepareVisitorPayment(ctx, visitor, { draftId: a.draft!.id, draftHash: a.draft!.hash, payer: me })),
      code(prepareVisitorPayment(ctx, visitor, { draftId: b.draft!.id, draftHash: b.draft!.hash, payer: me })),
    ]);
    expect(results.sort()).toEqual(["OK", "SEND_LIMIT"]);
  });

  it("refuses a list over the per-payment limit at check", async () => {
    const { ctx } = await testCtx({ VISITOR_SEND_LIMIT_PER_PAYMENT_USDC: "5" });
    expect(await code(checkVisitorList(ctx, visitor, { mode: "each", text: `${friend}, 6`, label: "gift" }))).toBe("SEND_LIMIT");
  });

  it("rate-limits checks per visitor and per IP", async () => {
    const { ctx } = await testCtx({ VISITOR_CHECKS_PER_HOUR: "2" });
    const input = { mode: "each" as const, text: `${friend}, 1`, label: "gift" };
    await checkVisitorList(ctx, visitor, input);
    await checkVisitorList(ctx, visitor, input);
    expect(await code(checkVisitorList(ctx, visitor, input))).toBe("TOO_MANY_CHECKS");
    expect(await code(checkVisitorList(ctx, { keyHash: "e".repeat(64), ip: visitor.ip }, input))).toBe("TOO_MANY_CHECKS");
    expect(await code(checkVisitorList(ctx, { keyHash: "e".repeat(64), ip: null }, input))).toBe("OK");
  });

  it("emails the receipt by itself to the email given when paying, once, after it lands", async () => {
    const { ctx, arc } = await testCtx();
    arc.mint(me, 10_000_000n);
    const p = await prepared(ctx, `${friend}, 2`, "payer@example.com");
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, payFromWallet(arc, p));
    await drive(ctx, p.transfer.id);
    await sweep(ctx);
    await sweep(ctx);
    expect(ctx.previewEmail!.receipts).toEqual([{ to: "payer@example.com", amount: "2.00", url: `${ctx.appUrl}/p/${p.transfer.visitorToken}` }]);
  });

  it("emails the visitor their receipt only once it has landed", async () => {
    const { ctx, arc } = await testCtx();
    arc.mint(me, 10_000_000n);
    const p = await prepared(ctx, `${friend}, 2`);
    expect(await code(emailVisitorReceipt(ctx, p.transfer.visitorToken!, "me@example.com"))).toBe("NOT_LANDED");
    await submitVisitorPayment(ctx, p.transfer.visitorToken!, payFromWallet(arc, p));
    await drive(ctx, p.transfer.id);
    await emailVisitorReceipt(ctx, p.transfer.visitorToken!, "Me@Example.com");
    expect(ctx.previewEmail!.receipts).toEqual([{ to: "me@example.com", amount: "2.00", url: `${ctx.appUrl}/p/${p.transfer.visitorToken}` }]);
    // Anyone holding the link can ask for the email; it never changes who the payment is from.
    expect((await visitorPaymentByToken(ctx, p.transfer.visitorToken!)).visitorEmail).toBeNull();
    const links = await receiptLinks(ctx, await visitorPaymentByToken(ctx, p.transfer.visitorToken!));
    expect((await receiptByToken(ctx, links![0]!)).from).toMatch(/^0x0000…00e1$/i);
    expect(await ctx.db.select().from(users)).toHaveLength(0);
  });

  it("anyone holding the link can read the payment", async () => {
    const { ctx } = await testCtx();
    const p = await prepared(ctx, `${friend}, 2`);
    // No visitor is passed: the token alone is the permission, like a receipt link.
    expect((await visitorPaymentByToken(ctx, p.transfer.visitorToken!)).id).toBe(p.transfer.id);
  });

  it("keeps sweeping other payments while many reservations are open", async () => {
    const { ctx } = await testCtx({ VISITOR_CHECKS_PER_HOUR: "1000" });
    for (let i = 0; i < 30; i++) await prepared(ctx, `${friend}, 1`);
    const { user } = await signedInUser(ctx, "host@example.com");
    const list = await checkPayout(ctx, user, { mode: "each", text: `${friend}, 1`, label: "gift" });
    const { transfer, action } = await quoteTransfer(ctx, user, { draftId: list.draft!.id, draftHash: list.draft!.hash, fundWith: "card" });
    await confirmTransfer(ctx, user, action.id, { pin: TEST_PIN });
    await sweep(ctx);
    expect((await getTransfer(ctx, transfer.id)).status).not.toBe("confirmed");
  });

  it("checks abandoned reservations with one cheap read, not a log scan on every sweep (mainnet RPC limit)", async () => {
    const { ctx, arc, clock } = await testCtx({ VISITOR_CHECKS_PER_HOUR: "1000" });
    arc.mint(me, 10_000_000n);
    for (let i = 0; i < 3; i++) await prepared(ctx, `${friend}, 1`);
    clock.advance(31 * 60_000);
    await sweep(ctx);
    let scans = 0;
    let reads = 0;
    const chain = {
      ...ctx.chain,
      findSplitSent: (...a: Parameters<Ctx["chain"]["findSplitSent"]>) => {
        scans++;
        return ctx.chain.findSplitSent(...a);
      },
      refUsed: (...a: Parameters<Ctx["chain"]["refUsed"]>) => {
        reads++;
        return ctx.chain.refUsed(...a);
      },
    };
    // A minute of sweeps, one every five seconds.
    for (let i = 0; i < 12; i++) {
      clock.advance(5_000);
      await sweep({ ...ctx, chain });
    }
    expect(scans).toBe(0);
    expect(reads).toBeLessThanOrEqual(3 * 2);
  });

  it("finds a late payment even behind many abandoned reservations", async () => {
    const { ctx, arc, clock } = await testCtx({ VISITOR_CHECKS_PER_HOUR: "1000" });
    arc.mint(me, 10_000_000n);
    const all = [];
    for (let i = 0; i < 30; i++) all.push(await prepared(ctx, `${friend}, 1`));
    clock.advance(31 * 60_000);
    for (let i = 0; i < 3; i++) await sweep(ctx);
    payFromWallet(arc, all.at(-1)!);
    // The sweeper runs every few seconds; time moves between runs (each reservation every 30s).
    for (let i = 0; i < 10; i++) {
      clock.advance(5_000);
      await sweep(ctx);
    }
    expect((await visitorPaymentByToken(ctx, all.at(-1)!.transfer.visitorToken!)).status).toBe("settled");
  });

  it("rate-limits reservations per visitor, and checks across all visitors", async () => {
    const { ctx } = await testCtx({ VISITOR_CHECKS_PER_HOUR: "2", VISITOR_CHECKS_GLOBAL_PER_HOUR: "3" });
    const list = await checkVisitorList(ctx, visitor, { mode: "each", text: `${friend}, 1`, label: "gift" });
    const again = { draftId: list.draft!.id, draftHash: list.draft!.hash, payer: me };
    expect(await code(prepareVisitorPayment(ctx, visitor, again))).toBe("OK");
    expect(await code(prepareVisitorPayment(ctx, visitor, again))).toBe("LIST_ALREADY_PAID");
    expect(await code(prepareVisitorPayment(ctx, visitor, again))).toBe("TOO_MANY_PREPARES");
    const input = { mode: "each" as const, text: `${friend}, 1`, label: "gift" };
    await checkVisitorList(ctx, { keyHash: "c".repeat(64), ip: null }, input);
    await checkVisitorList(ctx, { keyHash: "d".repeat(64), ip: null }, input);
    expect(await code(checkVisitorList(ctx, { keyHash: "e".repeat(64), ip: null }, input))).toBe("TOO_MANY_CHECKS");
  });

  it("finds nothing for an unknown token", async () => {
    const { ctx } = await testCtx();
    expect(await code(visitorPaymentByToken(ctx, "x".repeat(24)))).toBe("NOT_FOUND");
    expect(await code(visitorPaymentByToken(ctx, "../../etc"))).toBe("NOT_FOUND");
  });
});
