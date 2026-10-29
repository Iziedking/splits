import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Ctx } from "../context";
import { transfers } from "../db/schema";
import { AppError } from "../errors";
import { signedInUser, testCtx } from "../testing";
import { checkSendLimit } from "./sendLimits";

const USDC = 1_000_000n;
const WALLET = "0x00000000000000000000000000000000000000A1";

async function code(p: Promise<unknown>) {
  try {
    await p;
    return "OK";
  } catch (err) {
    if (err instanceof AppError) return `${err.code}: ${err.message}`;
    throw err;
  }
}

/** A payment row as the limit sees it. Only the columns the limit reads matter. */
async function past(
  ctx: Ctx,
  row: { amount: bigint; status?: string; userId?: string; walletId?: string; address?: string; email?: string; kind?: "pay" | "auto"; hoursAgo?: number; expiresInMin?: number },
) {
  const id = randomUUID();
  await ctx.db.insert(transfers).values({
    id,
    payerUserId: row.userId ?? null,
    payerWalletId: row.walletId ?? null,
    payerAddress: row.address ?? WALLET,
    funding: row.userId ? "balance" : "own_wallet",
    kind: row.kind ?? "pay",
    amount: row.amount.toString(),
    topUp: "0",
    expected: [],
    ref: `0x${id.replace(/-/g, "")}`,
    status: (row.status ?? "settled") as never,
    visitorEmail: row.email ?? null,
    expiresAt: row.expiresInMin === undefined ? null : new Date(ctx.now().getTime() + row.expiresInMin * 60_000),
    createdAt: new Date(ctx.now().getTime() - (row.hoursAgo ?? 1) * 3_600_000),
    updatedAt: ctx.now(),
  });
}

describe("send limit", () => {
  it("refuses one payment over 500 for accounts and visitors alike", async () => {
    const { ctx } = await testCtx();
    expect(await code(checkSendLimit(ctx.db, ctx, { address: WALLET }, "visitor", 500n * USDC))).toBe("OK");
    expect(await code(checkSendLimit(ctx.db, ctx, { address: WALLET }, "visitor", 500n * USDC + 1n))).toBe(
      "SEND_LIMIT: Payments over $500.00, including the Splits fee, need identity verification, which Splits does not offer yet. Lower the total to continue.",
    );
    expect(await code(checkSendLimit(ctx.db, ctx, { userId: randomUUID() }, "account", 501n * USDC))).toMatch(/^SEND_LIMIT/);
  });

  it("counts a rolling 24 hours per wallet, including live reservations", async () => {
    const { ctx } = await testCtx();
    await past(ctx, { amount: 300n * USDC, hoursAgo: 23 });
    await past(ctx, { amount: 100n * USDC, status: "awaiting_wallet", expiresInMin: 10, hoursAgo: 0 });
    await past(ctx, { amount: 400n * USDC, hoursAgo: 25 }); // outside the window
    await past(ctx, { amount: 400n * USDC, status: "cancelled" }); // never counted
    await past(ctx, { amount: 400n * USDC, status: "awaiting_wallet", expiresInMin: -1 }); // expired
    await past(ctx, { amount: 400n * USDC, kind: "auto" }); // receiver rules never count
    expect(await code(checkSendLimit(ctx.db, ctx, { address: WALLET }, "visitor", 100n * USDC))).toBe("OK");
    expect(await code(checkSendLimit(ctx.db, ctx, { address: WALLET }, "visitor", 100n * USDC + 1n))).toMatch(
      // The reservation (expires in 10 minutes) frees up before the 23-hour-old payment (in 1 hour).
      "SEND_LIMIT: You can send $100.00 more today, including the Splits fee. More frees up at 09:10 UTC.",
    );
  });

  it("counts the fee toward the limit", async () => {
    const { ctx } = await testCtx();
    await ctx.db.insert(transfers).values({
      id: randomUUID(),
      payerAddress: WALLET,
      funding: "own_wallet",
      kind: "pay",
      amount: (490n * USDC).toString(),
      feeAmount: (9n * USDC).toString(),
      topUp: "0",
      expected: [],
      ref: "0xfee",
      status: "settled",
      createdAt: ctx.now(),
      updatedAt: ctx.now(),
    });
    expect(await code(checkSendLimit(ctx.db, ctx, { address: WALLET }, "visitor", 1n * USDC))).toBe("OK");
    expect(await code(checkSendLimit(ctx.db, ctx, { address: WALLET }, "visitor", 1n * USDC + 1n))).toMatch(/^SEND_LIMIT/);
  });

  it("counts a wallet however its address is cased", async () => {
    const { ctx } = await testCtx();
    await past(ctx, { amount: 450n * USDC, address: WALLET.toLowerCase() });
    expect(await code(checkSendLimit(ctx.db, ctx, { address: WALLET }, "visitor", 51n * USDC))).toMatch(/^SEND_LIMIT/);
  });

  it("an email links visitor and account totals", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    await past(ctx, { amount: 450n * USDC, userId: user.id, address: "0x00000000000000000000000000000000000000B2" });
    // A visitor paying from another wallet but giving Ada's email is held to Ada's total.
    expect(await code(checkSendLimit(ctx.db, ctx, { address: WALLET, email: "ada@example.com" }, "visitor", 51n * USDC))).toMatch(/^SEND_LIMIT/);
    // And Ada's account sees what she paid as a visitor.
    await past(ctx, { amount: 40n * USDC, email: "ada@example.com" });
    expect(await code(checkSendLimit(ctx.db, ctx, { userId: user.id, email: user.email }, "account", 11n * USDC))).toMatch(/^SEND_LIMIT/);
  });

  it("a reservation counts against its wallet, not against the email it names", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    // Someone reserves 500 from their own wallet and types Ada's email: nothing has moved yet.
    await past(ctx, { amount: 500n * USDC, status: "awaiting_wallet", expiresInMin: 20, hoursAgo: 0, email: "ada@example.com" });
    expect(await code(checkSendLimit(ctx.db, ctx, { userId: user.id, email: user.email }, "account", 1n * USDC))).toBe("OK");
    expect(await code(checkSendLimit(ctx.db, ctx, { address: WALLET }, "visitor", 1n * USDC))).toMatch(/^SEND_LIMIT/);
  });

  it("uses the visitor limits for visitors", async () => {
    const { ctx } = await testCtx({ VISITOR_SEND_LIMIT_DAILY_USDC: "100" });
    await past(ctx, { amount: 90n * USDC });
    expect(await code(checkSendLimit(ctx.db, ctx, { address: WALLET }, "visitor", 11n * USDC))).toMatch(/^SEND_LIMIT/);
    expect(await code(checkSendLimit(ctx.db, ctx, { userId: randomUUID(), address: WALLET }, "account", 11n * USDC))).toBe("OK");
  });
});
