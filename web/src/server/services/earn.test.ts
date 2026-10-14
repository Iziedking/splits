import { eq } from "drizzle-orm";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { earnMoves, notifications } from "../db/schema";
import { signedInUser, TEST_PIN, testCtx } from "../testing";
import { advanceMove, confirmMove, depositIdle, earnStatus, earningPocket, openEarningPocket, startMove, sweepEarn } from "./earn";
import { mainWallet } from "./users";

const usdc = (n: number) => BigInt(Math.round(n * 1_000_000));

async function setup(env: Record<string, string> = {}) {
  const t = await testCtx({ EARN_ENABLED: "true", ...env });
  const { user } = await signedInUser(t.ctx, "ada@example.com");
  const main = (await mainWallet(t.ctx, user.id))!;
  t.arc.mint(main.address as Address, usdc(100));
  return { ...t, user, main };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function moveIn(t: Setup, amount: string) {
  const { action } = await startMove(t.ctx, t.user, "in", amount);
  const move = await confirmMove(t.ctx, t.user, action.id, { pin: TEST_PIN });
  for (let i = 0; i < 5; i++) await advanceMove(t.ctx, move.id);
  return (await t.ctx.db.select().from(earnMoves).where(eq(earnMoves.id, move.id)))[0]!;
}

async function moveOut(t: Setup, amount: string, steps = 6) {
  const { action } = await startMove(t.ctx, t.user, "out", amount);
  const move = await confirmMove(t.ctx, t.user, action.id, { pin: TEST_PIN });
  for (let i = 0; i < steps; i++) await advanceMove(t.ctx, move.id);
  return (await t.ctx.db.select().from(earnMoves).where(eq(earnMoves.id, move.id)))[0]!;
}

const titles = async (t: Setup) => (await t.ctx.db.select().from(notifications)).map((n) => n.title);
const balance = (t: Setup, address: string) => t.ctx.chain.usdcBalance(address as Address);

describe("the Earning pocket", () => {
  it("stays off unless the server turns it on", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "off@example.com");
    expect(await earnStatus(ctx, user.id)).toEqual({ available: false });
    await expect(openEarningPocket(ctx, user)).rejects.toThrow(/isn't available/);
  });

  it("opens one Earning pocket per person and shows the vault and its variable rate", async () => {
    const t = await setup();
    const a = await openEarningPocket(t.ctx, t.user);
    const b = await openEarningPocket(t.ctx, t.user);
    expect(b.id).toBe(a.id);
    expect(a.earn).toBe(true);
    expect(await earnStatus(t.ctx, t.user.id)).toMatchObject({
      available: true,
      vault: { name: "Preview USDC Vault", apy: 0.042 },
      pocket: { total: "0.00" },
    });
  });

  it("moves money in only after the PIN, then the sweeper puts it in the vault", async () => {
    const t = await setup();
    const pocket = await openEarningPocket(t.ctx, t.user);
    const { move } = await startMove(t.ctx, t.user, "in", "40");
    expect((await advanceMove(t.ctx, move.id)).status).toBe("awaiting_confirmation");
    expect(await balance(t, pocket.address)).toBe(0n);

    const done = await moveIn(t, "40");
    expect(done.status).toBe("done");
    expect(await balance(t, t.main.address)).toBe(usdc(60));
    await sweepEarn(t.ctx);
    expect(await balance(t, pocket.address)).toBe(0n);
    expect(await earnStatus(t.ctx, t.user.id)).toMatchObject({ pocket: { invested: "40.00", idle: "0.00", total: "40.00" } });
    expect(await titles(t)).toContain("$40.00 moved to your Earning pocket");
  });

  it("leaves amounts under the deposit floor waiting in the pocket", async () => {
    const t = await setup({ EARN_DEPOSIT_MIN_USDC: "1" });
    const pocket = await openEarningPocket(t.ctx, t.user);
    t.arc.mint(pocket.address as Address, usdc(0.5));
    expect(await depositIdle(t.ctx, pocket)).toBeNull();
    expect(t.arc.earnCalls).toHaveLength(0);
  });

  it("deposits idle money once, however often the sweeper runs", async () => {
    const t = await setup();
    const pocket = await openEarningPocket(t.ctx, t.user);
    t.arc.mint(pocket.address as Address, usdc(5));
    await Promise.all([sweepEarn(t.ctx), sweepEarn(t.ctx)]);
    await sweepEarn(t.ctx);
    expect(t.arc.earnCalls.filter((c) => c.kind === "deposit")).toEqual([
      { kind: "deposit", owner: pocket.address.toLowerCase(), amount: usdc(5) },
    ]);
  });

  it("moves money out of the vault and back to the spendable balance", async () => {
    const t = await setup();
    await openEarningPocket(t.ctx, t.user);
    await moveIn(t, "40");
    await sweepEarn(t.ctx);
    const done = await moveOut(t, "15");
    expect(done.status).toBe("done");
    expect(await balance(t, t.main.address)).toBe(usdc(75));
    expect(await earnStatus(t.ctx, t.user.id)).toMatchObject({ pocket: { invested: "25.00" } });
    expect(await titles(t)).toContain("$15.00 is back in your spendable balance");
  });

  it("never withdraws twice after a crash between the withdrawal and its record", async () => {
    const t = await setup();
    const pocket = await openEarningPocket(t.ctx, t.user);
    await moveIn(t, "40");
    await sweepEarn(t.ctx);
    const { action } = await startMove(t.ctx, t.user, "out", "10");
    const move = await confirmMove(t.ctx, t.user, action.id, { pin: TEST_PIN });
    // The vault paid out, but the process died before the move was updated.
    await t.ctx.earn!.withdraw(pocket.address as Address, usdc(10));
    for (let i = 0; i < 6; i++) await advanceMove(t.ctx, move.id);
    expect(t.arc.earnCalls.filter((c) => c.kind === "withdraw")).toHaveLength(1);
    expect(await balance(t, t.main.address)).toBe(usdc(70));
  });

  it("leaves the pocket alone while money is on its way out", async () => {
    const t = await setup();
    const pocket = await openEarningPocket(t.ctx, t.user);
    await moveIn(t, "40");
    await sweepEarn(t.ctx);
    const { action } = await startMove(t.ctx, t.user, "out", "10");
    const move = await confirmMove(t.ctx, t.user, action.id, { pin: TEST_PIN });
    await advanceMove(t.ctx, move.id); // withdrawn and on its way back, not finished
    expect((await t.ctx.db.select().from(earnMoves).where(eq(earnMoves.id, move.id)))[0]!.status).toBe("returning");
    // Money lands in the pocket meanwhile (an automatic split): it waits until the move is done.
    t.arc.mint(pocket.address as Address, usdc(5));
    const deposits = t.arc.earnCalls.filter((c) => c.kind === "deposit").length;
    expect(await depositIdle(t.ctx, (await earningPocket(t.ctx, t.user.id))!)).toBeNull();
    expect(t.arc.earnCalls.filter((c) => c.kind === "deposit")).toHaveLength(deposits);
  });

  it("moves everything out even when the vault rounds down", async () => {
    const t = await setup();
    await openEarningPocket(t.ctx, t.user);
    await moveIn(t, "1");
    await sweepEarn(t.ctx);
    t.arc.earnShortfall = 1n;
    const done = await moveOut(t, "1");
    expect(done.status).toBe("done");
    expect(done.amount).toBe("999999");
  });

  it("refuses to move more than there is, either way", async () => {
    const t = await setup();
    await openEarningPocket(t.ctx, t.user);
    await expect(startMove(t.ctx, t.user, "in", "100.01")).rejects.toThrow(/\$100\.00 to move/);
    await expect(startMove(t.ctx, t.user, "out", "1")).rejects.toThrow(/About \$0\.00/);
  });

  it("waits, untouched, while Earn is switched off", async () => {
    const t = await setup();
    await openEarningPocket(t.ctx, t.user);
    await moveIn(t, "40");
    await sweepEarn(t.ctx);
    const { action } = await startMove(t.ctx, t.user, "out", "10");
    const move = await confirmMove(t.ctx, t.user, action.id, { pin: TEST_PIN });
    const off = { ...t.ctx, earn: null };
    expect((await advanceMove(off, move.id)).status).toBe("confirmed");
    expect(await sweepEarn(off)).toBe(0);
  });

  it("puts an automatic split's share into the vault", async () => {
    const t = await setup();
    const pocket = await openEarningPocket(t.ctx, t.user);
    // What an automatic split does: pay the pocket's address.
    t.arc.mint(pocket.address as Address, usdc(12));
    await sweepEarn(t.ctx);
    expect(await earnStatus(t.ctx, t.user.id)).toMatchObject({ pocket: { invested: "12.00" } });
  });
});
