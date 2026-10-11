import { eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import type { Ctx } from "../context";
import { providerTxs, transfers, users } from "../db/schema";
import { AppError } from "../errors";
import { PREVIEW_TREASURY_WALLET_ID } from "../preview/previewArc";
import { signedInUser, TEST_PIN, testCtx } from "../testing";
import { advanceWithRules } from "./rules";
import { advanceSplit, confirmSplit, draftSplit, type SplitInput } from "./splits";
import { sweep } from "./sweeper";
import { activeTransferIds, advanceTransfer, confirmTransfer, getTransfer, quoteTransfer } from "./transfers";
import { createPocket, mainWallet, type User } from "./users";

const familySplit: SplitInput = {
  name: "Family in Lagos",
  legs: [
    { name: "Landlord", to: { type: "email", email: "landlord@example.com" }, amount: { type: "percent", percent: 40 }, purpose: "rent" },
    { name: "School", to: { type: "email", email: "school@example.com" }, amount: { type: "percent", percent: 35 }, purpose: "school fees" },
    { name: "Sister", to: { type: "email", email: "sister@example.com" }, amount: { type: "percent", percent: 25 }, purpose: "upkeep" },
  ],
};

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  return "OK";
}

async function activeSplit(ctx: Ctx, owner: User, input: SplitInput = familySplit) {
  const { split, action } = await draftSplit(ctx, owner, input);
  let current = await confirmSplit(ctx, owner, action.id, { pin: TEST_PIN });
  for (let i = 0; i < 5 && current.status === "pending"; i++) current = await advanceSplit(ctx, split.id);
  expect(current.status).toBe("active");
  return current;
}

async function drive(ctx: Ctx, transferId: string) {
  let t = await getTransfer(ctx, transferId);
  for (let i = 0; i < 20 && !["settled", "failed"].includes(t.status); i++) t = await advanceWithRules(ctx, transferId);
  return t;
}

/** Runs the background sweeper until no payment has work left, the way the server would. */
async function settleEverything(ctx: Ctx) {
  for (let i = 0; i < 20 && (await activeTransferIds(ctx, 100)).length > 0; i++) await sweep(ctx);
}

async function pay(ctx: Ctx, user: User, splitId: string, pence: number) {
  const { transfer, action } = await quoteTransfer(ctx, user, { splitId, fundWith: "card", currency: "GBP", fiatMinor: pence });
  await confirmTransfer(ctx, user, action.id, { pin: TEST_PIN });
  return drive(ctx, transfer.id);
}

async function balanceOf(ctx: Ctx, email: string) {
  const [u] = await ctx.db.select().from(users).where(eq(users.email, email));
  const w = await mainWallet(ctx, u!.id);
  return ctx.chain.usdcBalance(w!.address as Address);
}

describe("sending money home through a split", () => {
  it("pays every recipient by email, verifies the receipt, and records purposes", async () => {
    const { ctx, arc } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    expect(split.onchainId).toBe(1n);

    // Recipients named by email were given wallets before they ever signed in.
    const invited = await ctx.db.select().from(users).where(eq(users.email, "sister@example.com"));
    expect(invited[0]?.status).toBe("invited");

    const treasuryBefore = await ctx.chain.usdcBalance(arc.walletAddress(PREVIEW_TREASURY_WALLET_ID)!);
    const t = await pay(ctx, user, split.id, 1000); // £10.00 -> 12.70 USDC

    expect(t.status).toBe("settled");
    expect(t.amount).toBe("12700000");
    expect(await balanceOf(ctx, "landlord@example.com")).toBe(5_080_000n);
    expect(await balanceOf(ctx, "school@example.com")).toBe(4_445_000n);
    expect(await balanceOf(ctx, "sister@example.com")).toBe(3_175_000n);
    expect(await balanceOf(ctx, "ada@example.com")).toBe(0n);
    expect(treasuryBefore - (await ctx.chain.usdcBalance(arc.walletAddress(PREVIEW_TREASURY_WALLET_ID)!))).toBe(12_700_000n);

    const receipt = await ctx.chain.receipt(t.txHash as Hex);
    expect(receipt?.legPaid.map((l) => l.amount)).toEqual([5_080_000n, 4_445_000n, 3_175_000n]);

    const steps = await ctx.db.select().from(providerTxs).where(eq(providerTxs.subjectId, t.id));
    expect(steps.map((s) => s.step).sort()).toEqual(["approve", "fund", "send"]);
    expect(steps.every((s) => s.status === "complete")).toBe(true);
  });

  it("finishes a payment nobody polls, through the background sweeper", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const { transfer, action } = await quoteTransfer(ctx, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 1000 });
    await confirmTransfer(ctx, user, action.id, { pin: TEST_PIN }); // the user closes the app here
    await settleEverything(ctx);
    expect((await getTransfer(ctx, transfer.id)).status).toBe("settled");
    expect(await balanceOf(ctx, "sister@example.com")).toBe(3_175_000n);
  });

  it("refuses a second confirmation of the same payment", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const { action } = await quoteTransfer(ctx, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 500 });
    await confirmTransfer(ctx, user, action.id, { pin: TEST_PIN });
    expect(await code(confirmTransfer(ctx, user, action.id, { pin: TEST_PIN }))).toBe("ALREADY_CONFIRMED");
  });

  it("hides one user's splits from another", async () => {
    const { ctx } = await testCtx();
    const { user: ada } = await signedInUser(ctx, "ada@example.com");
    const { user: eve } = await signedInUser(ctx, "eve@example.com");
    const split = await activeSplit(ctx, ada);
    expect(
      await code(quoteTransfer(ctx, eve, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 500 })),
    ).toBe("NOT_FOUND");
  });
});

describe("receiver-side automatic splits", () => {
  it("runs the sister's own rule on the money she receives, once", async () => {
    const { ctx } = await testCtx();
    const { user: ada } = await signedInUser(ctx, "ada@example.com");
    const family = await activeSplit(ctx, ada);

    // The sister signs in later with the same email and finds the same wallet.
    const { user: sister, wallet: sisterMain } = await signedInUser(ctx, "sister@example.com");
    const savings = await createPocket(ctx, sister, "Savings");
    await activeSplit(ctx, sister, {
      name: "Save 30%",
      autoForWalletId: sisterMain.id,
      legs: [
        { name: "Savings", to: { type: "wallet", walletId: savings.id }, amount: { type: "percent", percent: 30 }, purpose: "savings" },
        { name: "Spending", to: { type: "wallet", walletId: sisterMain.id }, amount: { type: "percent", percent: 70 }, purpose: "spending" },
      ],
    });

    const parent = await pay(ctx, ada, family.id, 1000);
    expect(parent.status).toBe("settled");
    // Nobody is watching the sister's automatic split; the sweeper finishes it.
    await settleEverything(ctx);

    const autos = await ctx.db.select().from(transfers).where(eq(transfers.parentTransferId, parent.id));
    expect(autos).toHaveLength(1);
    expect(autos[0]!.status).toBe("settled");
    expect(await ctx.chain.usdcBalance(savings.address as Address)).toBe(952_500n); // 30% of 3.175
    expect(await ctx.chain.usdcBalance(sisterMain.address as Address)).toBe(2_222_500n);

    // Driving the parent again must not start a second automatic split.
    await advanceWithRules(ctx, parent.id);
    expect(await ctx.db.select().from(transfers).where(eq(transfers.parentTransferId, parent.id))).toHaveLength(1);
  });
});

describe("automatic splits don't chain", () => {
  it("money moved by one automatic split never triggers another", async () => {
    const { ctx } = await testCtx();
    const { user: ada } = await signedInUser(ctx, "ada@example.com");
    const family = await activeSplit(ctx, ada);

    // A ping-pong setup: main sends 30% to the pocket, the pocket sends everything back to main.
    const { user: sister, wallet: main } = await signedInUser(ctx, "sister@example.com");
    const pocket = await createPocket(ctx, sister, "Savings");
    await activeSplit(ctx, sister, {
      name: "Save 30%",
      autoForWalletId: main.id,
      legs: [
        { name: "Savings", to: { type: "wallet", walletId: pocket.id }, amount: { type: "percent", percent: 30 }, purpose: "savings" },
        { name: "Spending", to: { type: "wallet", walletId: main.id }, amount: { type: "percent", percent: 70 }, purpose: "spending" },
      ],
    });
    await activeSplit(ctx, sister, {
      name: "Sweep back",
      autoForWalletId: pocket.id,
      legs: [{ name: "Main", to: { type: "wallet", walletId: main.id }, amount: { type: "percent", percent: 100 }, purpose: "back" }],
    });

    await pay(ctx, ada, family.id, 1000);
    await settleEverything(ctx);
    const autos = await ctx.db.select().from(transfers).where(eq(transfers.kind, "auto"));
    expect(autos).toHaveLength(1);
    expect(await ctx.chain.usdcBalance(pocket.address as Address)).toBe(952_500n);
  });
});

describe("failure is honest and nothing is paid twice", () => {
  it("a blocklisted recipient stops the whole payment; nobody is paid", async () => {
    const { ctx, arc } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const [school] = await ctx.db.select().from(users).where(eq(users.email, "school@example.com"));
    arc.setBlocked((await mainWallet(ctx, school!.id))!.address as Address, true);

    const t = await pay(ctx, user, split.id, 1000);
    expect(t.status).toBe("failed");
    expect(t.lastError).toMatch(/can't receive USDC/);
    expect(await balanceOf(ctx, "landlord@example.com")).toBe(0n);
    // The top-up landed and stays in the sender's wallet, where the app shows it.
    expect(await balanceOf(ctx, "ada@example.com")).toBe(12_700_000n);
    expect(await ctx.chain.refUsed((await mainWallet(ctx, user.id))!.address as Address, t.ref as Hex)).toBe(false);
  });

  it("a provider call that succeeded before a crash is not sent twice", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);

    let sends = 0;
    let crashed = false;
    const realExecute = ctx.wallets.execute;
    const flaky: Ctx = {
      ...ctx,
      wallets: {
        ...ctx.wallets,
        execute: async (input) => {
          const result = await realExecute(input);
          if (input.refId.startsWith("send:")) {
            sends++;
            if (!crashed) {
              crashed = true;
              throw new Error("process died after the provider accepted the call");
            }
          }
          return result;
        },
      },
    };

    const { transfer, action } = await quoteTransfer(flaky, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 1000 });
    await confirmTransfer(flaky, user, action.id, { pin: TEST_PIN });
    let t = await getTransfer(flaky, transfer.id);
    for (let i = 0; i < 20 && t.status !== "settled"; i++) {
      try {
        t = await advanceTransfer(flaky, transfer.id);
      } catch {
        t = await getTransfer(flaky, transfer.id);
      }
    }
    expect(t.status).toBe("settled");
    expect(sends).toBe(2); // called twice with the same idempotency key ...
    expect(await balanceOf(ctx, "landlord@example.com")).toBe(5_080_000n); // ... paid once
  });

  it("parallel workers settle a payment exactly once", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const { transfer, action } = await quoteTransfer(ctx, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 1000 });
    await confirmTransfer(ctx, user, action.id, { pin: TEST_PIN });

    for (let round = 0; round < 10; round++) {
      await Promise.all(Array.from({ length: 5 }, () => advanceWithRules(ctx, transfer.id)));
    }
    expect((await getTransfer(ctx, transfer.id)).status).toBe("settled");
    const rows = await ctx.db.select().from(providerTxs).where(eq(providerTxs.subjectId, transfer.id));
    expect(rows).toHaveLength(3);
    expect(await balanceOf(ctx, "sister@example.com")).toBe(3_175_000n);
  });

  it("flags a payment whose onchain receipt doesn't match what the user approved", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const { transfer, action } = await quoteTransfer(ctx, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 1000 });
    const tampered = transfer.expected.map((l, i) => (i === 0 ? { ...l, amount: "9999999" } : l));
    await ctx.db.update(transfers).set({ expected: tampered }).where(eq(transfers.id, transfer.id));
    await confirmTransfer(ctx, user, action.id, { pin: TEST_PIN });

    const t = await drive(ctx, transfer.id);
    expect(t.status).toBe("failed");
    expect(t.lastError).toMatch(/does not match/);
  });
});

describe("spend ceilings on the simulated card top-up", () => {
  it("refuses a single top-up over the per-payment cap", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    expect(
      await code(quoteTransfer(ctx, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 3000 })),
    ).toBe("FUNDING_LIMIT");
  });

  it("stops at the per-user daily cap even when payments race", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const quotes = await Promise.all(
      [1000, 1000].map((p) => quoteTransfer(ctx, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: p })),
    );
    for (const q of quotes) await confirmTransfer(ctx, user, q.action.id, { pin: TEST_PIN });
    const results = await Promise.all(quotes.map((q) => drive(ctx, q.transfer.id)));

    expect(results.map((r) => r.status).sort()).toEqual(["failed", "settled"]);
    expect(results.find((r) => r.status === "failed")!.lastError).toMatch(/today's card top-up limit/);
  });

  it("FUNDING_ENABLED=false switches top-ups off", async () => {
    const { ctx } = await testCtx({ FUNDING_ENABLED: "false" });
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    expect(
      await code(quoteTransfer(ctx, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 500 })),
    ).toBe("FUNDING_OFF");
  });

  it("paying from balance needs the balance", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    expect(await code(quoteTransfer(ctx, user, { splitId: split.id, fundWith: "balance", usdc: "5" }))).toBe(
      "INSUFFICIENT_BALANCE",
    );
  });
});

describe("confirmation", () => {
  it("locks after five wrong PINs, even when the guesses arrive at once", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const { action } = await draftSplit(ctx, user, familySplit);
    // Eleven wrong guesses and the right PIN, all at once. Only five may be checked at all, so the
    // right one, arriving last, must be refused unchecked.
    const pins = [...Array.from({ length: 11 }, (_, i) => `9${String(i).padStart(5, "0")}`), TEST_PIN];
    const guesses = await Promise.all(pins.map((pin) => code(confirmSplit(ctx, user, action.id, { pin }))));
    expect(guesses).not.toContain("OK");
    expect(guesses.filter((c) => c === "PIN_WRONG").length).toBeLessThanOrEqual(4);
    expect(await code(confirmSplit(ctx, user, action.id, { pin: TEST_PIN }))).toBe("PIN_LOCKED");
  });

  it("expires an unconfirmed request after five minutes", async () => {
    const { ctx, clock } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const { action } = await draftSplit(ctx, user, familySplit);
    clock.advance(6 * 60_000);
    expect(await code(confirmSplit(ctx, user, action.id, { pin: TEST_PIN }))).toBe("ACTION_EXPIRED");
  });

  it("rejects a split whose percentages don't add up, before anything goes onchain", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const bad = structuredClone(familySplit);
    bad.legs[2]!.amount = { type: "percent", percent: 24.99 };
    expect(await code(draftSplit(ctx, user, bad))).toBe("SHARES_MUST_TOTAL");
  });
});
