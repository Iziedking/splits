import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { notifications, users } from "../db/schema";
import { testCtx } from "../testing";
import { notifyPaymentOutcome } from "./paymentNotifications";
import type { Transfer } from "./transfers";
import { ensureMainWallet, ensureUser } from "./users";

async function setup() {
  const t = await testCtx();
  const ada = await ensureUser(t.ctx, "ada@example.com", "active");
  const adaWallet = await ensureMainWallet(t.ctx, ada);
  const bola = await ensureUser(t.ctx, "bola@example.com", "active");
  const bolaWallet = await ensureMainWallet(t.ctx, bola);
  const transfer = (over: Partial<Transfer>): Transfer =>
    ({
      id: "00000000-0000-4000-8000-0000000000aa",
      payerUserId: ada.id,
      payerWalletId: adaWallet.id,
      payerAddress: adaWallet.address,
      kind: "pay",
      amount: "30000000",
      feeAmount: "450000",
      status: "settled",
      expected: [
        { name: "bola@example.com", address: bolaWallet.address.toLowerCase(), amount: "20000000", purpose: "rent", email: "bola@example.com" },
        { name: "0xF1", address: "0x00000000000000000000000000000000000000f1", amount: "10000000", purpose: "rent", email: null },
      ],
      ...over,
    }) as Transfer;
  return { ...t, ada, bola, transfer };
}

const rows = async (ctx: Awaited<ReturnType<typeof setup>>["ctx"]) =>
  (await ctx.db.select().from(notifications).orderBy(notifications.sourceKey)).map((n) => ({ who: n.userId, key: n.sourceKey, title: n.title, body: n.body, email: n.email }));

describe("payment notifications", () => {
  it("tells the payer it landed and each recipient with an account what they got, once", async () => {
    const { ctx, ada, bola, transfer } = await setup();
    await notifyPaymentOutcome(ctx, transfer({}));
    await notifyPaymentOutcome(ctx, transfer({}));
    expect(await rows(ctx)).toEqual([
      { who: bola.id, key: `received:${transfer({}).id}:${bola.id}`, title: "You received $20.00", body: 'From ada@example.com, for "rent".', email: "none" },
      { who: ada.id, key: `transfer:${transfer({}).id}:settled`, title: "Landed: $30.45 reached 2 people", body: "Each person has a receipt.", email: "pending" },
    ]);
  });

  it("names a payer who had a Split tag by the tag they paid with, never the email", async () => {
    const { ctx, ada, bola, transfer } = await setup();
    await ctx.db.update(users).set({ tag: "ada_now" }).where(eq(users.id, ada.id));
    await notifyPaymentOutcome(ctx, transfer({ payerTag: "adakitchen" }));
    const received = (await rows(ctx)).find((r) => r.who === bola.id)!;
    expect(received.body).toBe('From @adakitchen, for "rent".');
  });

  it("emails someone paid by their tag, who gets no other email", async () => {
    const { ctx, bola, transfer } = await setup();
    const byTag = transfer({ expected: [{ ...transfer({}).expected[0]!, name: "@bola", email: null }] });
    await notifyPaymentOutcome(ctx, byTag);
    expect((await rows(ctx)).find((r) => r.who === bola.id)!.email).toBe("pending");
  });

  it("names the one person a single payment reached", async () => {
    const { ctx, transfer } = await setup();
    const one = transfer({ expected: [transfer({}).expected[1]!], amount: "10000000", feeAmount: "150000" });
    await notifyPaymentOutcome(ctx, one);
    expect((await rows(ctx)).map((r) => r.title)).toEqual(["Landed: $10.15 reached 0xF1"]);
  });

  it("says a failed payment sent nothing", async () => {
    const { ctx, ada, transfer } = await setup();
    await notifyPaymentOutcome(ctx, transfer({ status: "failed" }));
    expect(await rows(ctx)).toEqual([
      { who: ada.id, key: `transfer:${transfer({}).id}:failed`, title: "Payment not sent", body: "Your $30.45 payment didn't go through. No one was paid.", email: "pending" },
    ]);
  });

  it("doesn't say nothing was sent when a sent payment was flagged for review (final review I8)", async () => {
    const { ctx, transfer } = await setup();
    await notifyPaymentOutcome(
      ctx,
      transfer({ status: "failed", txHash: "0xabc", lastError: "The payment record doesn't match what you approved. Flagged for review." }),
    );
    expect((await rows(ctx)).map((r) => [r.title, r.body])).toEqual([
      ["Payment flagged for review", "Your $30.45 payment went out but didn't match what you approved. Splits is checking it."],
    ]);
  });

  it("notes an automatic split in the app only", async () => {
    const { ctx, transfer } = await setup();
    await notifyPaymentOutcome(ctx, transfer({ kind: "auto", feeAmount: "0" }));
    expect((await rows(ctx)).filter((r) => r.key.startsWith("auto:"))).toEqual([
      expect.objectContaining({ title: "Your automatic split moved $30.00", email: "none" }),
    ]);
  });

  it("has no one to tell when a visitor paid from their own wallet", async () => {
    const { ctx, bola, transfer } = await setup();
    await notifyPaymentOutcome(ctx, transfer({ payerUserId: null, payerWalletId: null, payerAddress: "0x00000000000000000000000000000000000000c0" }));
    expect(await rows(ctx)).toEqual([expect.objectContaining({ who: bola.id, body: 'From 0x0000…00c0, for "rent".' })]);
  });
});
