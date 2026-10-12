import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { testCtx } from "../testing";
import { depositMoves, depositWallets, notifications, users } from "./schema";

async function setup() {
  const { ctx } = await testCtx();
  const [user] = await ctx.db.insert(users).values({ email: "ada@example.com", status: "active" }).returning();
  const [wallet] = await ctx.db
    .insert(depositWallets)
    .values({ userId: user!.id, chain: "base", providerWalletId: "pw-base", address: "0xaa904b4ac117838ce68f5263cfe3e0a7ee4a267c" })
    .returning();
  return { ctx, user: user!, wallet: wallet! };
}

describe("deposit and notification tables", () => {
  it("keeps one deposit wallet per person per chain", async () => {
    const { ctx, user } = await setup();
    await expect(
      ctx.db.insert(depositWallets).values({ userId: user.id, chain: "base", providerWalletId: "pw-other", address: "0x01" }),
    ).rejects.toThrow();
  });

  it("allows only one active move per deposit wallet", async () => {
    const { ctx, user, wallet } = await setup();
    const move = { depositWalletId: wallet.id, userId: user.id, chain: "base", burnAmount: "1000000" } as const;
    await ctx.db.insert(depositMoves).values({ ...move, status: "burning" });
    await expect(ctx.db.insert(depositMoves).values({ ...move, status: "attesting" })).rejects.toThrow();
    // Finished moves don't block the next one.
    await ctx.db.update(depositMoves).set({ status: "ready" }).where(eq(depositMoves.depositWalletId, wallet.id));
    await ctx.db.insert(depositMoves).values({ ...move, status: "burning" });
  });

  it("stores one notification per event, and people get email alerts unless they turn them off", async () => {
    const { ctx, user } = await setup();
    const n = { userId: user.id, sourceKey: "deposit:1:ready", kind: "deposit_ready", title: "Ready", body: "b" };
    const first = await ctx.db.insert(notifications).values(n).onConflictDoNothing().returning();
    const second = await ctx.db.insert(notifications).values(n).onConflictDoNothing().returning();
    expect([first.length, second.length]).toEqual([1, 0]);
    expect(first[0]!.email).toBe("none");
    expect(user.emailAlerts).toBe(true);
  });
});
