import { describe, expect, it } from "vitest";
import { payoutDrafts, rateHits, supportChats, supportMessages } from "../db/schema";
import { testCtx } from "../testing";
import { ensureUser } from "./users";
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
    expect(removed).toEqual({ rateHits: 3, drafts: 1, supportChats: 0 });
    expect(await ctx.db.select().from(payoutDrafts)).toHaveLength(1);
    expect((await ctx.db.select().from(rateHits)).length).toBeGreaterThan(0);
  });

  it("deletes support chats older than 90 days with their messages", async () => {
    const { ctx } = await testCtx();
    const user = await ensureUser(ctx, "ada@example.com", "active");
    const day = 24 * 60 * 60_000;
    const now = ctx.now().getTime();
    const made: string[] = [];
    for (const age of [91, 89]) {
      const [chat] = await ctx.db.insert(supportChats).values({ userId: user.id, status: "open", createdAt: new Date(now - age * day) }).returning();
      await ctx.db.insert(supportMessages).values({ chatId: chat!.id, role: "person", text: "hello", createdAt: new Date(now - age * day) });
      made.push(chat!.id);
    }
    const removed = await pruneStale(ctx);
    expect(removed.supportChats).toBe(1);
    expect((await ctx.db.select().from(supportChats)).map((c) => c.id)).toEqual([made[1]]);
    expect((await ctx.db.select().from(supportMessages)).map((m) => m.chatId)).toEqual([made[1]]);
  });
});
