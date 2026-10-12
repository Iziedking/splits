import { eq } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import type { Ctx } from "../context";
import { notifications, providerTxs, splits, transfers, users } from "../db/schema";
import { AppError } from "../errors";
import { formatUsdc } from "../domain/money";
import { PREVIEW_TREASURY_WALLET_ID } from "../preview/previewArc";
import { signedInUser, TEST_PIN, testCtx } from "../testing";
import { transferView } from "../views";
import { activityFor } from "./activity";
import { checkPayout } from "./payouts";
import { receiptByToken, receiptLinks } from "./receipts";
import { advanceWithRules } from "./rules";
import { advanceSplit, confirmSplit, draftSplit, splitsFor, type SplitInput } from "./splits";
import { sweep } from "./sweeper";
import {
  activeTransferIds,
  advanceTransfer,
  confirmTransfer,
  getTransfer,
  previewTransfer,
  quoteTransfer,
  refreshPendingSteps,
} from "./transfers";
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
  it("tells nobody again when an old payment is opened later (final review I7)", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const t = await pay(ctx, user, split.id, 1000);
    expect(t.status).toBe("settled");
    // A payment from before notifications existed: none were ever written for it.
    await ctx.db.delete(notifications);
    await advanceWithRules(ctx, t.id);
    expect(await ctx.db.select().from(notifications)).toHaveLength(0);
  });

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
    expect(await balanceOf(ctx, "school@example.com")).toBe(4_440_000n);
    expect(await balanceOf(ctx, "sister@example.com")).toBe(3_180_000n);
    expect(await balanceOf(ctx, "ada@example.com")).toBe(0n);
    expect(treasuryBefore - (await ctx.chain.usdcBalance(arc.walletAddress(PREVIEW_TREASURY_WALLET_ID)!))).toBe(12_700_000n);

    const receipt = await ctx.chain.receipt(t.txHash as Hex);
    expect(receipt?.legPaid.map((l) => l.amount)).toEqual([5_080_000n, 4_440_000n, 3_180_000n]);

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
    expect(await balanceOf(ctx, "sister@example.com")).toBe(3_180_000n);
  });

  it("brings step records up to date when the chain moved faster than the provider", async () => {
    // Seen on Arc Testnet: the approval shows onchain before Circle reports it complete, so the
    // payment settles while the approve record still says pending.
    const { ctx } = await testCtx({}, { pendingPolls: 4 });
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const t = await pay(ctx, user, split.id, 1000);
    expect(t.status).toBe("settled");

    for (let i = 0; i < 6; i++) await refreshPendingSteps(ctx, t.id);
    const steps = await ctx.db.select().from(providerTxs).where(eq(providerTxs.subjectId, t.id));
    expect(steps.map((s) => s.status)).toEqual(["complete", "complete", "complete"]);
  });

  it("refuses a second confirmation of the same payment", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const { action } = await quoteTransfer(ctx, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 500 });
    await confirmTransfer(ctx, user, action.id, { pin: TEST_PIN });
    expect(await code(confirmTransfer(ctx, user, action.id, { pin: TEST_PIN }))).toBe("ALREADY_CONFIRMED");
  });

  it("leaves drafts the user never approved out of their list", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    await draftSplit(ctx, user, familySplit); // approval dialog cancelled
    const approved = await activeSplit(ctx, user, { ...familySplit, name: "Approved one" });
    expect((await splitsFor(ctx, user.id)).map((s) => s.id)).toEqual([approved.id]);
  });

  it("previews the exact breakdown without creating a payment", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const preview = await previewTransfer(ctx, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 1000 });
    expect(preview.amount).toBe("12.70");
    expect(preview.rate).toBe("1.27");
    expect(preview.legs.map((l) => l.amount)).toEqual(["5.08", "4.44", "3.18"]);
    expect(await ctx.db.select().from(transfers)).toHaveLength(0);
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
    expect(await ctx.chain.usdcBalance(savings.address as Address)).toBe(950_000n); // 30% of 3.18, rounded down to the cent
    expect(await ctx.chain.usdcBalance(sisterMain.address as Address)).toBe(2_230_000n);

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
    expect(await ctx.chain.usdcBalance(pocket.address as Address)).toBe(950_000n);
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
    expect(await balanceOf(ctx, "sister@example.com")).toBe(3_180_000n);
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

// ------------------------------------------------------------------ one-off payments to a checked list

const winner = (n: number) => getAddress(`0x${(0xbeef00 + n).toString(16).padStart(40, "0")}`);

async function checkedDraft(ctx: Ctx, user: User, text: string, pot = "10") {
  const res = await checkPayout(ctx, user, { mode: "equal", text, pot, label: "giveaway prize" });
  expect(res.ready).toBe(true);
  return res.draft!;
}

async function payDraft(ctx: Ctx, user: User, draft: { id: string; hash: string }, fundWith: "card" | "balance" = "card") {
  const { transfer, action } = await quoteTransfer(ctx, user, { draftId: draft.id, draftHash: draft.hash, fundWith });
  await confirmTransfer(ctx, user, action.id, { pin: TEST_PIN });
  return drive(ctx, transfer.id);
}

describe("paying a checked list in one transaction", () => {
  it("pays 20 winners, mixing addresses and emails, and verifies every leg", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "host@example.com");
    const lines = [...Array.from({ length: 15 }, (_, i) => winner(i)), ...Array.from({ length: 5 }, (_, i) => `w${i}@example.com`)];
    const draft = await checkedDraft(ctx, user, lines.join("\n"), "20");
    const t = await payDraft(ctx, user, draft);
    expect(t.status).toBe("settled");
    expect(t.kind).toBe("pay");
    expect(t.splitId).toBeNull();
    for (let i = 0; i < 15; i++) expect(await ctx.chain.usdcBalance(winner(i))).toBe(1_000_000n);
    expect(await balanceOf(ctx, "w4@example.com")).toBe(1_000_000n);
  });

  it("pays from the balance without a top-up", async () => {
    const { ctx, arc } = await testCtx();
    const { user } = await signedInUser(ctx, "host@example.com");
    arc.mint((await mainWallet(ctx, user.id))!.address as Address, 5_000_000n);
    const draft = await checkedDraft(ctx, user, [winner(1), winner(2)].join("\n"), "3");
    const t = await payDraft(ctx, user, draft, "balance");
    expect(t.status).toBe("settled");
    expect(t.topUp).toBe("0");
    expect(await balanceOf(ctx, "host@example.com")).toBe(2_000_000n);
  });

  it("creates exactly one payment when the same list is paid twice", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "host@example.com");
    const draft = await checkedDraft(ctx, user, winner(1));
    await quoteTransfer(ctx, user, { draftId: draft.id, draftHash: draft.hash, fundWith: "card" });
    expect(await code(quoteTransfer(ctx, user, { draftId: draft.id, draftHash: draft.hash, fundWith: "card" }))).toBe("LIST_ALREADY_PAID");
  });

  it("refuses a list that changed or expired", async () => {
    const { ctx, clock } = await testCtx();
    const { user } = await signedInUser(ctx, "host@example.com");
    const draft = await checkedDraft(ctx, user, winner(1));
    expect(await code(quoteTransfer(ctx, user, { draftId: draft.id, draftHash: "f".repeat(64), fundWith: "card" }))).toBe("LIST_CHANGED");
    clock.advance(31 * 60_000);
    expect(await code(quoteTransfer(ctx, user, { draftId: draft.id, draftHash: draft.hash, fundWith: "card" }))).toBe("LIST_CHANGED");
  });

  it("sends nothing when a winner is blocked after the check, and keeps the top-up in the balance", async () => {
    const { ctx, arc } = await testCtx();
    const { user } = await signedInUser(ctx, "host@example.com");
    const draft = await checkedDraft(ctx, user, [winner(1), winner(2)].join("\n"), "2");
    arc.setBlocked(winner(2), true);
    const t = await payDraft(ctx, user, draft);
    expect(t.status).toBe("failed");
    expect(t.lastError).toBe(
      "One recipient can't receive USDC right now. Nothing was sent. $2.00 from the demo card is still in your balance.",
    );
    expect(await ctx.chain.usdcBalance(winner(1))).toBe(0n);
    expect(await balanceOf(ctx, "host@example.com")).toBe(2_000_000n);
  });

  it("says nothing was sent when the provider gives only a generic reason", async () => {
    const { ctx, arc } = await testCtx();
    const { user } = await signedInUser(ctx, "host@example.com");
    const draft = await checkedDraft(ctx, user, [winner(1), winner(2)].join("\n"), "2");
    arc.setBlocked(winner(2), true);
    // Circle reports a failed contract call without the revert's name.
    const getTx = ctx.wallets.getTx;
    ctx.wallets.getTx = async (id) => {
      const tx = await getTx(id);
      return tx.status === "failed" ? { ...tx, error: "ESTIMATION_ERROR" } : tx;
    };
    const t = await payDraft(ctx, user, draft);
    expect(t.status).toBe("failed");
    expect(t.lastError).toBe("Arc rejected the payment. Nothing was sent. $2.00 from the demo card is still in your balance.");
  });

  it("runs a winner's automatic split on what they received", async () => {
    const { ctx } = await testCtx();
    const { user: host } = await signedInUser(ctx, "host@example.com");
    const { user: bob } = await signedInUser(ctx, "bob@example.com");
    const pocket = await createPocket(ctx, bob, "Savings");
    const bobMain = (await mainWallet(ctx, bob.id))!;
    await activeSplit(ctx, bob, {
      name: "Save",
      autoForWalletId: bobMain.id,
      legs: [
        { name: "Savings", to: { type: "wallet", walletId: pocket.id }, amount: { type: "percent", percent: 50 }, purpose: "savings" },
        { name: "Main", to: { type: "wallet", walletId: bobMain.id }, amount: { type: "percent", percent: 50 }, purpose: "spending" },
      ],
    });
    const draft = await checkedDraft(ctx, host, "bob@example.com", "4");
    await payDraft(ctx, host, draft);
    await settleEverything(ctx);
    expect(await ctx.chain.usdcBalance(pocket.address as Address)).toBe(2_000_000n);
  });
});

describe("telling email recipients they were paid", () => {
  it("sends one notice per email recipient, never to the payer, and never twice", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "host@example.com");
    const draft = await checkedDraft(ctx, user, ["a@example.com", "b@example.com", winner(1)].join("\n"), "3");
    await payDraft(ctx, user, draft);
    await sweep(ctx);
    await sweep(ctx);
    const notices = ctx.previewEmail!.notices;
    expect(notices.map((n) => n.to).sort()).toEqual(["a@example.com", "b@example.com"]);
    expect(notices[0]!.notice).toMatchObject({ from: "host@example.com", amount: "1.00", purpose: "giveaway prize" });
  });

  it("retries a failed notice and never blocks the payment", async () => {
    const { ctx, clock } = await testCtx();
    const { user } = await signedInUser(ctx, "host@example.com");
    let failures = 1;
    const real = ctx.email.sendPaymentNotice.bind(ctx.email);
    ctx.email.sendPaymentNotice = async (to, n) => {
      if (failures-- > 0) throw new Error("provider down");
      return real(to, n);
    };
    const draft = await checkedDraft(ctx, user, "a@example.com", "1");
    const t = await payDraft(ctx, user, draft);
    expect(t.status).toBe("settled");
    await sweep(ctx);
    expect(ctx.previewEmail!.notices).toHaveLength(0);
    // Backs off instead of hammering the provider: nothing goes out until the retry time.
    await sweep(ctx);
    expect(ctx.previewEmail!.notices).toHaveLength(0);
    clock.advance(31_000);
    await sweep(ctx);
    expect(ctx.previewEmail!.notices).toHaveLength(1);
  });

  it("never sends a notice to the payer", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "host@example.com");
    // A saved split may name the payer's own email (the payout check blocks this for lists).
    const split = await activeSplit(ctx, user, {
      name: "Me and Ada",
      legs: [
        { name: "Me", to: { type: "email", email: "host@example.com" }, amount: { type: "percent", percent: 50 }, purpose: "keep" },
        { name: "Ada", to: { type: "email", email: "ada@example.com" }, amount: { type: "percent", percent: 50 }, purpose: "gift" },
      ],
    });
    await pay(ctx, user, split.id, 100);
    await sweep(ctx);
    expect(ctx.previewEmail!.notices.map((n) => n.to)).toEqual(["ada@example.com"]);
  });
});

describe("activity", () => {
  it("shows what you received with its label and sender, and survives the provider being down", async () => {
    const { ctx } = await testCtx();
    const { user: host } = await signedInUser(ctx, "host@example.com");
    const { user: bob } = await signedInUser(ctx, "bob@example.com");
    const draft = await checkedDraft(ctx, host, "bob@example.com", "2");
    await payDraft(ctx, host, draft);

    const a = await activityFor(ctx, bob);
    expect(a.receivedError).toBeNull();
    expect(a.received.find((r) => r.amount === "2.00")).toMatchObject({ purpose: "giveaway prize", fromLabel: "host@example.com" });

    // The demo card's top-up comes from the app's treasury; it is named, not shown as a bare address.
    const hostActivity = await activityFor(ctx, host);
    expect(hostActivity.received).toEqual([expect.objectContaining({ amount: "2.00", fromLabel: "Demo card top-up", source: "topup" })]);

    ctx.wallets.listInbound = async () => {
      throw new Error("down");
    };
    const down = await activityFor(ctx, host);
    expect(down.receivedError).toBe("Couldn't load received payments. Try again.");
    expect(down.sent).toHaveLength(1);
  });
});

describe("polling a payment", () => {
  it("answers within its time budget instead of waiting for the payment to settle", async () => {
    const { ctx } = await testCtx({}, { pendingPolls: 0 });
    const { user } = await signedInUser(ctx, "host@example.com");
    const draft = await checkedDraft(ctx, user, [winner(1), winner(2)].join("\n"), "2");
    const { transfer, action } = await quoteTransfer(ctx, user, { draftId: draft.id, draftHash: draft.hash, fundWith: "card" });
    await confirmTransfer(ctx, user, action.id, { pin: TEST_PIN });

    const polled = await advanceWithRules(ctx, transfer.id, 1);
    expect(polled.status).not.toBe("settled");
    expect((await drive(ctx, transfer.id)).status).toBe("settled");
  });
});

describe("receipts", () => {
  it("gives each recipient a link to a receipt that shows only their part", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada.obi@example.com");
    const split = await activeSplit(ctx, user);
    const t = await pay(ctx, user, split.id, 1_000);
    expect(t.status).toBe("settled");

    const links = await receiptLinks(ctx, t);
    expect(links).toHaveLength(3);
    expect(new Set(links).size).toBe(3);
    expect(await receiptLinks(ctx, t)).toEqual(links);

    const school = await receiptByToken(ctx, links![1]!);
    const schoolLeg = t.expected[1]!;
    expect(school).toMatchObject({
      name: "School",
      purpose: "school fees",
      amount: formatUsdc(BigInt(schoolLeg.amount)),
      to: schoolLeg.address,
      from: "Ada",
      txHash: t.txHash,
      simulated: true,
      whole: false,
    });
    const shown = JSON.stringify(school);
    for (const other of [t.expected[0]!, t.expected[2]!]) {
      expect(shown).not.toContain(other.name);
      expect(shown).not.toContain(other.address);
    }
    expect(shown).not.toContain(formatUsdc(BigInt(t.amount)));
    expect(shown).not.toContain("ada.obi@example.com");
  });

  it("says a one-person payment is the whole payment, not a part of one", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "host@example.com");
    const t = await payDraft(ctx, user, await checkedDraft(ctx, user, winner(1), "2"));
    const [link] = (await receiptLinks(ctx, t))!;
    expect(await receiptByToken(ctx, link!)).toMatchObject({ whole: true, amount: "2.00" });
  });

  it("has no links before the payment settles", async () => {
    const { ctx } = await testCtx();
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const { transfer } = await quoteTransfer(ctx, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 1_000 });
    expect(await receiptLinks(ctx, transfer)).toBeNull();
  });

  it("finds nothing for an unknown or malformed link", async () => {
    const { ctx } = await testCtx();
    expect(await code(receiptByToken(ctx, "A".repeat(24)))).toBe("NOT_FOUND");
    expect(await code(receiptByToken(ctx, "'; drop table transfers;--"))).toBe("NOT_FOUND");
  });
});

describe("the Splits fee", () => {
  const fees = { FEE_BPS: "150", FEE_MANY_BPS: "200", FEE_MANY_FROM_RECIPIENTS: "10" };

  it("charges the fee on top and pays it in the same transaction", async () => {
    const { ctx, arc } = await testCtx(fees);
    const { user } = await signedInUser(ctx, "host@example.com");
    const payer = (await mainWallet(ctx, user.id))!.address as Address;
    arc.mint(payer, 10_000_000n);
    const feeBefore = await ctx.chain.usdcBalance(ctx.fees.address);
    const t = await payDraft(ctx, user, await checkedDraft(ctx, user, [winner(1), winner(2)].join("\n"), "4"), "balance");
    expect(t.status).toBe("settled");
    expect(t.feeAmount).toBe("60000");
    expect(t.feeBps).toBe(150);
    expect(await ctx.chain.usdcBalance(winner(1))).toBe(2_000_000n);
    expect(await ctx.chain.usdcBalance(payer)).toBe(10_000_000n - 4_060_000n);
    expect((await ctx.chain.usdcBalance(ctx.fees.address)) - feeBefore).toBe(60_000n);
    const receipt = await ctx.chain.receipt(t.txHash as Hex);
    expect(receipt!.legPaid.at(-1)).toMatchObject({ recipient: ctx.fees.address, amount: 60_000n });
  });

  it("uses the many-people rate from the cutoff", async () => {
    const { ctx } = await testCtx(fees);
    const { user } = await signedInUser(ctx, "host@example.com");
    for (const [people, bps] of [[9, 150], [10, 200], [11, 200]] as const) {
      const list = Array.from({ length: people }, (_, i) => winner(100 * people + i)).join("\n");
      const draft = await checkedDraft(ctx, user, list, String(people));
      const { transfer } = await quoteTransfer(ctx, user, { draftId: draft.id, draftHash: draft.hash, fundWith: "card" });
      expect(transfer.feeBps).toBe(bps);
    }
  });

  it("keeps the quoted fee when the rate changes before the payment runs", async () => {
    const { ctx, arc } = await testCtx(fees);
    const { user } = await signedInUser(ctx, "host@example.com");
    arc.mint((await mainWallet(ctx, user.id))!.address as Address, 10_000_000n);
    const draft = await checkedDraft(ctx, user, [winner(1), winner(2)].join("\n"), "4");
    const { transfer, action } = await quoteTransfer(ctx, user, { draftId: draft.id, draftHash: draft.hash, fundWith: "balance" });
    ctx.fees = { ...ctx.fees, rule: { ...ctx.fees.rule, bps: 900 } };
    await confirmTransfer(ctx, user, action.id, { pin: TEST_PIN });
    const t = await drive(ctx, transfer.id);
    expect(t.status).toBe("settled");
    expect(t.feeAmount).toBe("60000");
  });

  it("tops the demo card up by the amount plus the fee", async () => {
    const { ctx } = await testCtx(fees);
    const { user } = await signedInUser(ctx, "host@example.com");
    const draft = await checkedDraft(ctx, user, [winner(1), winner(2)].join("\n"), "4");
    const { transfer } = await quoteTransfer(ctx, user, { draftId: draft.id, draftHash: draft.hash, fundWith: "card" });
    expect(transfer.topUp).toBe("4060000");
  });

  it("says what a saved-split card payment charged, fee included", async () => {
    const { ctx } = await testCtx(fees);
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const { transfer } = await quoteTransfer(ctx, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 1_000 });
    const view = transferView(ctx, transfer);
    expect(view.quote).toMatchObject({ currency: "GBP", fiat: "10.00", charged: view.total });
    expect(view.total).toBe("12.89");
  });

  it("refuses a balance payment that covers the amount but not the fee", async () => {
    const { ctx, arc } = await testCtx(fees);
    const { user } = await signedInUser(ctx, "host@example.com");
    arc.mint((await mainWallet(ctx, user.id))!.address as Address, 4_000_000n);
    const draft = await checkedDraft(ctx, user, [winner(1), winner(2)].join("\n"), "4");
    expect(await code(quoteTransfer(ctx, user, { draftId: draft.id, draftHash: draft.hash, fundWith: "balance" }))).toBe("INSUFFICIENT_BALANCE");
  });

  it("pays a saved split through pay(), each person as the template says, plus the fee", async () => {
    const { ctx } = await testCtx(fees);
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const t = await pay(ctx, user, split.id, 1_000);
    expect(t.status).toBe("settled");
    const receipt = await ctx.chain.receipt(t.txHash as Hex);
    expect(receipt!.splitSent[0]!.splitId).toBe(0n);
    const paid = receipt!.legPaid.map((l) => l.amount);
    const want = t.expected.map((l) => BigInt(l.amount)).filter((a) => a > 0n);
    expect(paid).toEqual([...want, BigInt(t.feeAmount)]);
    expect(BigInt(t.feeAmount)).toBeGreaterThan(0n);
  });

  it("refuses to pay a saved split that changed after approval", async () => {
    const { ctx } = await testCtx(fees);
    const { user } = await signedInUser(ctx, "ada@example.com");
    const split = await activeSplit(ctx, user);
    const { transfer, action } = await quoteTransfer(ctx, user, { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 1_000 });
    await ctx.db.update(splits).set({ version: split.version + 1 }).where(eq(splits.id, split.id));
    await confirmTransfer(ctx, user, action.id, { pin: TEST_PIN });
    const t = await drive(ctx, transfer.id);
    expect(t.status).toBe("failed");
    expect(t.lastError).toMatch(/^The split changed after you confirmed\. Nothing was sent\./);
  });
});

describe("send limit on account payments", () => {
  it("refuses an account payment over the limit at quote and again at confirm", async () => {
    const { ctx, arc } = await testCtx({ SEND_LIMIT_DAILY_USDC: "3" });
    const { user } = await signedInUser(ctx, "host@example.com");
    arc.mint((await mainWallet(ctx, user.id))!.address as Address, 10_000_000n);
    const first = await checkedDraft(ctx, user, [winner(1), winner(2)].join("\n"), "2");
    const second = await checkedDraft(ctx, user, [winner(3), winner(4)].join("\n"), "2");
    const a = await quoteTransfer(ctx, user, { draftId: first.id, draftHash: first.hash, fundWith: "balance" });
    const b = await quoteTransfer(ctx, user, { draftId: second.id, draftHash: second.hash, fundWith: "balance" });
    await confirmTransfer(ctx, user, a.action.id, { pin: TEST_PIN });
    expect(await code(confirmTransfer(ctx, user, b.action.id, { pin: TEST_PIN }))).toBe("SEND_LIMIT");
    expect((await getTransfer(ctx, b.transfer.id)).status).toBe("cancelled");
    const third = await checkedDraft(ctx, user, [winner(5), winner(6)].join("\n"), "2");
    expect(await code(quoteTransfer(ctx, user, { draftId: third.id, draftHash: third.hash, fundWith: "balance" }))).toBe("SEND_LIMIT");
  });
});
