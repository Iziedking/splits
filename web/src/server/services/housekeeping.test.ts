import { describe, expect, it } from "vitest";
import { payoutDrafts, rateHits } from "../db/schema";
import { testCtx } from "../testing";
import { pruneStale } from "./housekeeping";
import { checkVisitorList } from "./visitorPayments";

describe("housekeeping", () => {
  it("drops old rate-limit counters and unused visitor lists, and keeps recent ones", async () => {
    const { ctx, clock } = await testCtx();
    const input = { mode: "each" as const, text: "0x00000000000000000000000000000000000000f1, 1", label: "gift" };
    await checkVisitorList(ctx, { keyHash: "a".repeat(64), ip: "203.0.113.7" }, input);
    clock.advance(3 * 24 * 60 * 60_000);
    await checkVisitorList(ctx, { keyHash: "b".repeat(64), ip: null }, input);

    const removed = await pruneStale(ctx);
    expect(removed).toEqual({ rateHits: 3, drafts: 1 });
    expect(await ctx.db.select().from(payoutDrafts)).toHaveLength(1);
    expect((await ctx.db.select().from(rateHits)).length).toBeGreaterThan(0);
  });
});
