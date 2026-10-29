import { describe, expect, it } from "vitest";
import { receiptView } from "../views";
import { testCtx } from "../testing";
import type { Transfer } from "./transfers";

const t = {
  id: "00000000-0000-4000-8000-0000000000aa",
  status: "settled",
  amount: "5000000",
  feeAmount: "0",
  expected: [{ name: "@adakitchen", address: "0x00000000000000000000000000000000000000f1", amount: "5000000", purpose: "cake", email: null }],
  createdAt: new Date("2026-10-29T10:00:00Z"),
  settledAt: new Date("2026-10-29T10:00:05Z"),
  payerAddress: "0x00000000000000000000000000000000000000a1",
} as unknown as Transfer;

describe("tags on receipts", () => {
  it("name a payer who has a tag by the tag", async () => {
    const { ctx } = await testCtx();
    expect(receiptView(ctx, t, 0, { email: "bo@example.com", tag: "bo_pays", address: t.payerAddress }).from).toBe("@bo_pays");
  });

  it("are unchanged for a payer without one", async () => {
    const { ctx } = await testCtx();
    const out = receiptView(ctx, t, 0, { email: "bo@example.com", tag: null, address: t.payerAddress });
    expect(out.from).not.toContain("@");
  });

  it("show a tag recipient as the tag, with no email", async () => {
    const { ctx } = await testCtx();
    const out = JSON.stringify(receiptView(ctx, t, 0, { email: null, tag: null, address: t.payerAddress }));
    expect(out).toContain("@adakitchen");
    expect(out).not.toContain("example.com");
  });
});
