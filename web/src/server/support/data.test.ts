import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { supportChats, supportMessages } from "../db/schema";
import { testCtx } from "../testing";
import { ensureUser } from "../services/users";

describe("support chat tables", () => {
  it("keeps messages under their chat and deletes them with it", async () => {
    const { ctx } = await testCtx();
    const user = await ensureUser(ctx, "ada@example.com", "active");
    const [chat] = await ctx.db.insert(supportChats).values({ userId: user.id, status: "open" }).returning();
    await ctx.db.insert(supportMessages).values([
      { chatId: chat!.id, role: "person", text: "Where is my money?" },
      { chatId: chat!.id, role: "action", text: "Looked up the payment", tool: "lookup" },
    ]);
    expect(await ctx.db.select().from(supportMessages).where(eq(supportMessages.chatId, chat!.id))).toHaveLength(2);
    await ctx.db.delete(supportChats).where(eq(supportChats.id, chat!.id));
    expect(await ctx.db.select().from(supportMessages)).toHaveLength(0);
  });

  it("hands chats over by email to the support inbox", async () => {
    const { ctx } = await testCtx();
    expect(ctx.supportInbox).toBe("support@mysplits.xyz");
    const h = { chatId: "c", userEmail: "a@b.co", ref: null, summary: "s", payment: null, transcript: [] };
    await ctx.supportDesk.handOver(h);
    expect(ctx.previewEmail!.handovers).toEqual([{ to: "support@mysplits.xyz", replyTo: "a@b.co", h }]);
  });
});
