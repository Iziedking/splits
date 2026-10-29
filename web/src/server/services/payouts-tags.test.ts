import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notifications } from "../db/schema";
import { signedInUser, TEST_PIN, testCtx } from "../testing";
import { advanceWithRules } from "./rules";
import { checkPayout } from "./payouts";
import { advanceSplit, confirmSplit, draftSplit } from "./splits";
import { claimTag, confirmTagChange, startTagChange } from "./tags";
import { confirmTransfer, getTransfer, quoteTransfer } from "./transfers";
import { mainWallet, type User } from "./users";
import type { Ctx } from "../context";

async function setup() {
  const { ctx } = await testCtx();
  const host = await claimTag(ctx, (await signedInUser(ctx, "host@example.com")).user, "host");
  const ada = await claimTag(ctx, (await signedInUser(ctx, "ada@example.com")).user, "adakitchen");
  return { ctx, host, ada };
}

async function settle(ctx: Ctx, id: string) {
  let t = await getTransfer(ctx, id);
  for (let i = 0; i < 20 && !["settled", "failed"].includes(t.status); i++) t = await advanceWithRules(ctx, id);
  return t;
}

async function payThroughSplit(ctx: Ctx, payer: User, splitId: string) {
  const { transfer, action } = await quoteTransfer(ctx, payer, { splitId, fundWith: "card", currency: "GBP", fiatMinor: 1000 });
  await confirmTransfer(ctx, payer, action.id, { pin: TEST_PIN });
  return settle(ctx, transfer.id);
}

describe("paying a Split tag", () => {
  it("resolves to the holder's account and never shows their email", async () => {
    const { ctx, host, ada } = await setup();
    const res = await checkPayout(ctx, host, { mode: "each", text: "@AdaKitchen, 5", label: "cake" });
    expect(res.ready).toBe(true);
    expect(res.lines[0]).toMatchObject({ recipient: "@adakitchen", status: "ready" });
    expect(JSON.stringify(res)).not.toContain("ada@example.com");
    expect((await mainWallet(ctx, ada.id))!.address).toBeTruthy();
  });

  it("pays nobody through an unknown or retired tag, and calls your own tag you", async () => {
    const { ctx, host, ada } = await setup();
    const { action } = await startTagChange(ctx, ada, "ada_new");
    await confirmTagChange(ctx, ada, action.id, { pin: TEST_PIN });
    const res = await checkPayout(ctx, host, { mode: "each", text: "@nobody_here, 1\n@adakitchen, 1\n@host, 1", label: "x" });
    expect(res.lines.map((l) => l.message)).toEqual(["No Splits account uses @nobody_here", "No Splits account uses @adakitchen", "That's you"]);
    expect(res.ready).toBe(false);
  });

  it("knows a tag and the same person's email are one person", async () => {
    const { ctx, host } = await setup();
    const res = await checkPayout(ctx, host, { mode: "each", text: "@adakitchen, 1\nada@example.com, 1", label: "x" });
    expect(res.lines[1]!.status).toBe("duplicate");
  });

  it("works for visitors paying from their own wallet", async () => {
    const { ctx } = await setup();
    const res = await checkPayout(ctx, { visitorKeyHash: "v".repeat(64) }, { mode: "each", text: "@adakitchen, 2", label: "tip" });
    expect(res.lines[0]).toMatchObject({ recipient: "@adakitchen", status: "ready" });
  });

  it("a saved split keeps paying the same person after they change their tag, and they're told", async () => {
    const { ctx, host, ada } = await setup();
    const { split, action } = await draftSplit(ctx, host, {
      name: "Cake",
      legs: [{ name: "Ada", to: { type: "tag", tag: "@adakitchen" }, amount: { type: "percent", percent: 100 }, purpose: "cake" }],
    });
    let current = await confirmSplit(ctx, host, action.id, { pin: TEST_PIN });
    for (let i = 0; i < 5 && current.status === "pending"; i++) current = await advanceSplit(ctx, split.id);

    const change = await startTagChange(ctx, ada, "ada_bakes");
    await confirmTagChange(ctx, ada, change.action.id, { pin: TEST_PIN });

    const before = await ctx.chain.usdcBalance((await mainWallet(ctx, ada.id))!.address as `0x${string}`);
    const paid = await payThroughSplit(ctx, host, split.id);
    expect(paid.status).toBe("settled");
    const after = await ctx.chain.usdcBalance((await mainWallet(ctx, ada.id))!.address as `0x${string}`);
    expect(after > before).toBe(true);
    expect(JSON.stringify(paid.expected)).not.toContain("ada@example.com");
    expect((await ctx.db.select().from(notifications).where(eq(notifications.userId, ada.id))).length).toBeGreaterThan(0);
  });
});
