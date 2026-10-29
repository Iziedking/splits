import { and, asc, eq } from "drizzle-orm";
import type { EmailSender } from "../auth/email";
import type { Ctx } from "../context";
import { supportChats, supportMessages } from "../db/schema";
import { notFound } from "../errors";
import type { User } from "../services/users";
import { runTool } from "./tools";

export type Handover = {
  chatId: string;
  userEmail: string;
  ref: string | null;
  summary: string;
  payment: string | null;
  transcript: { role: "person" | "agent" | "action"; text: string; at: string }[];
};

/** Where a chat goes when the agent hands it to a person. Email today; a shared helpdesk later replaces only this. */
export interface SupportDesk {
  handOver(h: Handover): Promise<void>;
}

export function emailDesk(email: EmailSender, inbox: string): SupportDesk {
  return { handOver: (h) => email.sendSupportHandover(inbox, h.userEmail, h) };
}

export const handedOverText = (email: string) => `We've passed this to the Splits team. A person will reply to ${email} within 24 hours.`;

/**
 * Passes a chat to the team, once: the chat is marked handed over before anything is sent, so a
 * second tap (or a second request racing the first) finds it taken and sends nothing. If the send
 * fails the chat opens again and the person gets the address to write to themselves.
 */
export async function handOver(ctx: Ctx, user: User, chatId: string, summary: string): Promise<{ ok: boolean; text: string }> {
  const [chat] = await ctx.db
    .update(supportChats)
    .set({ status: "handed_over", handedOverAt: ctx.now() })
    .where(and(eq(supportChats.id, chatId), eq(supportChats.userId, user.id), eq(supportChats.status, "open")))
    .returning();
  if (!chat) {
    const [existing] = await ctx.db
      .select()
      .from(supportChats)
      .where(and(eq(supportChats.id, chatId), eq(supportChats.userId, user.id)))
      .limit(1);
    if (!existing) throw notFound("Chat not found");
    return { ok: true, text: handedOverText(user.email) };
  }

  try {
    const messages = await ctx.db.select().from(supportMessages).where(eq(supportMessages.chatId, chat.id)).orderBy(asc(supportMessages.createdAt));
    const payment = chat.ref ? await runTool(ctx, user, "get_payment", { ref: chat.ref }) : null;
    await ctx.supportDesk.handOver({
      chatId: chat.id,
      userEmail: user.email,
      ref: chat.ref,
      summary,
      payment: payment?.ok ? payment.text : null,
      transcript: messages.map((m) => ({ role: m.role, text: m.text, at: m.createdAt.toISOString() })),
    });
  } catch (err) {
    console.error(`[support] hand-over of chat ${chat.id} failed: ${err instanceof Error ? `${err.name} ${err.message}` : "error"}`);
    await ctx.db.update(supportChats).set({ status: "open", handedOverAt: null }).where(eq(supportChats.id, chat.id));
    const quote = chat.ref ? ` and quote ${chat.ref}` : "";
    return { ok: false, text: `We couldn't pass this on right now. Email ${ctx.supportInbox}${quote}.` };
  }
  return { ok: true, text: handedOverText(user.email) };
}
