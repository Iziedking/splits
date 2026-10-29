import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { supportHandoverEmail } from "../auth/email";
import type { Ctx } from "../context";
import { supportChats, supportMessages } from "../db/schema";
import { testCtx } from "../testing";
import { ensureUser, type User } from "../services/users";
import { handOver, type Handover } from "./handover";

async function setup() {
  const t = await testCtx();
  const ada = await ensureUser(t.ctx, "ada@example.com", "active");
  return { ...t, ada };
}

async function chat(ctx: Ctx, user: User, ref: string | null = "8F3C12AA0B1C") {
  const [c] = await ctx.db.insert(supportChats).values({ userId: user.id, ref, status: "open" }).returning();
  await ctx.db.insert(supportMessages).values([
    { chatId: c!.id, role: "person", text: "Where is my money?" },
    { chatId: c!.id, role: "action", text: "Checked payment 8F3C12AA0B1C again: Splitting and paying out.", tool: "recheck_payment" },
  ]);
  return c!;
}

const status = async (ctx: Ctx, id: string) => (await ctx.db.select().from(supportChats).where(eq(supportChats.id, id)))[0]!.status;

const sample: Handover = {
  chatId: "c1",
  userEmail: "ada@example.com",
  ref: "8F3C12AA0B1C",
  summary: "Ada's payment has been sending for an hour.",
  payment: "8F3C12AA0B1C: $30.00 to Landlord. Splitting and paying out.",
  transcript: [
    { role: "person", text: "Where is my money?", at: "2026-10-29T10:00:00.000Z" },
    { role: "action", text: "Checked payment 8F3C12AA0B1C again: Splitting and paying out.", at: "2026-10-29T10:00:05.000Z" },
  ],
};

describe("handing a chat to a person", () => {
  it("hands over once, to the inbox, replying to the person", async () => {
    const { ctx, ada } = await setup();
    const c = await chat(ctx, ada);
    const text = "We've passed this to the Splits team. A person will reply to ada@example.com within 24 hours.";
    expect(await handOver(ctx, ada, c.id, "Payment still sending")).toEqual({ ok: true, text });
    expect(await handOver(ctx, ada, c.id, "Payment still sending")).toEqual({ ok: true, text });
    const sent = ctx.previewEmail!.handovers;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ctx.supportInbox, replyTo: "ada@example.com" });
    expect(sent[0]!.h).toMatchObject({ ref: "8F3C12AA0B1C", summary: "Payment still sending" });
    expect(sent[0]!.h.transcript.map((m) => m.role)).toEqual(["person", "action"]);
    expect(await status(ctx, c.id)).toBe("handed_over");
  });

  it("concurrent handOver calls send once", async () => {
    const { ctx, ada } = await setup();
    const c = await chat(ctx, ada);
    await Promise.all([handOver(ctx, ada, c.id, "a"), handOver(ctx, ada, c.id, "b")]);
    expect(ctx.previewEmail!.handovers).toHaveLength(1);
  });

  it("someone else's chat is not found", async () => {
    const { ctx, ada } = await setup();
    const bo = await ensureUser(ctx, "bo@example.com", "active");
    const c = await chat(ctx, ada);
    await expect(handOver(ctx, bo, c.id, "x")).rejects.toMatchObject({ status: 404 });
    expect(ctx.previewEmail!.handovers).toHaveLength(0);
  });

  it("a failed send keeps the chat open", async () => {
    const { ctx, ada } = await setup();
    const failing: Ctx = { ...ctx, supportDesk: { handOver: async () => Promise.reject(new Error("provider down")) } };
    const withRef = await chat(ctx, ada);
    expect(await handOver(failing, ada, withRef.id, "x")).toEqual({
      ok: false,
      text: "We couldn't pass this on right now. Email support@mysplits.xyz and quote 8F3C12AA0B1C.",
    });
    expect(await status(ctx, withRef.id)).toBe("open");
    const noRef = await chat(ctx, ada, null);
    expect((await handOver(failing, ada, noRef.id, "x")).text).toBe("We couldn't pass this on right now. Email support@mysplits.xyz.");
  });

  it("subject names the payment, and the text carries everything the team needs", () => {
    const e = supportHandoverEmail(sample);
    expect(e.subject).toBe("Help with payment 8F3C12AA0B1C");
    expect(supportHandoverEmail({ ...sample, ref: null }).subject).toBe("Help with Splits");
    for (const part of [sample.summary, sample.payment!, "Where is my money?", "Agent did: Checked payment", "ada@example.com"]) expect(e.text).toContain(part);
  });
});
