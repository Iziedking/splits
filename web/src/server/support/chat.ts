import { and, asc, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { windowEnds, withTimeout } from "../agent/timing";
import type { Ctx } from "../context";
import { supportChats, supportMessages } from "../db/schema";
import { AppError, badRequest, conflict, notFound, tooMany, unavailable } from "../errors";
import { hitRateLimit, refundRateHit } from "../services/rateLimits";
import type { User } from "../services/users";
import { handOver } from "./handover";
import type { SupportReply, SupportTurn } from "./model";
import { runTool } from "./tools";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The person's 12th message hands the chat over: a conversation that long needs a person. */
const MAX_PERSON_MESSAGES = 12;
const MAX_MESSAGE = 1000;
const MAX_ROUNDS = 4;
/** Tools that change something: each one that goes through leaves a line in the chat saying what it did. */
const WRITES = new Set(["recheck_payment", "retry_deposit", "resend_receipts"]);
const TIMEOUT = "The agent didn't answer in time. Try again, or talk to a person.";
const LONG = "Long conversation; please read the chat";

/** One request to the chat route: a message, or the "Talk to a person" button. Never both. */
export const chatInput = z.union([
  z.object({ chatId: z.uuid().optional(), ref: z.string().max(40).nullish(), text: z.string().min(1).max(MAX_MESSAGE) }).strict(),
  z.object({ chatId: z.uuid().optional(), ref: z.string().max(40).nullish(), person: z.literal(true) }).strict(),
]);

export type ChatMessage = { role: "person" | "agent" | "action"; text: string; at: string };
export type ChatView = { id: string; ref: string | null; status: "open" | "handed_over" | "closed"; messages: ChatMessage[] };
type Chat = typeof supportChats.$inferSelect;
type Message = typeof supportMessages.$inferSelect;

/** The person's own text can never close (or reopen) its data wrapper. */
const wrap = (text: string) => `<message>\n${text.replace(/<\/?message>/gi, "")}\n</message>`;

async function ownChat(ctx: Ctx, user: User, chatId: string): Promise<Chat> {
  const [chat] = await ctx.db
    .select()
    .from(supportChats)
    .where(and(eq(supportChats.id, chatId), eq(supportChats.userId, user.id)))
    .limit(1);
  if (!chat) throw notFound("Chat not found");
  return chat;
}

async function messagesOf(ctx: Ctx, chatId: string): Promise<Message[]> {
  return ctx.db.select().from(supportMessages).where(eq(supportMessages.chatId, chatId)).orderBy(asc(supportMessages.createdAt));
}

async function say(ctx: Ctx, chatId: string, role: Message["role"], text: string, tool: string | null = null) {
  // Messages written in one turn keep their order even when the clock doesn't move.
  const [newest] = await ctx.db
    .select({ at: supportMessages.createdAt })
    .from(supportMessages)
    .where(eq(supportMessages.chatId, chatId))
    .orderBy(desc(supportMessages.createdAt))
    .limit(1);
  const now = ctx.now();
  const at = newest && newest.at >= now ? new Date(newest.at.getTime() + 1) : now;
  await ctx.db.insert(supportMessages).values({ chatId, role, text, tool, createdAt: at });
}

async function view(ctx: Ctx, chatId: string): Promise<ChatView> {
  const [chat] = await ctx.db.select().from(supportChats).where(eq(supportChats.id, chatId)).limit(1);
  const rows = await messagesOf(ctx, chatId);
  return { id: chat!.id, ref: chat!.ref, status: chat!.status, messages: rows.map((m) => ({ role: m.role, text: m.text, at: m.createdAt.toISOString() })) };
}

/** What the model sees: the chat so far, with every action it took as a tool call and its result. */
function history(rows: Message[]): SupportTurn[] {
  return rows.flatMap((m): SupportTurn[] => {
    if (m.role === "person") return [{ role: "person", text: wrap(m.text) }];
    if (m.role === "agent") return [{ role: "agent", text: m.text }];
    return [
      { role: "tool_call", id: m.id, name: m.tool ?? "unknown", input: {} },
      { role: "tool_result", id: m.id, text: m.text },
    ];
  });
}

async function finishWithHandover(ctx: Ctx, user: User, chatId: string, summary: string): Promise<ChatView> {
  const result = await handOver(ctx, user, chatId, summary);
  await say(ctx, chatId, "agent", result.text);
  return view(ctx, chatId);
}

export async function getChat(ctx: Ctx, user: User, chatId: string): Promise<ChatView> {
  return view(ctx, (await ownChat(ctx, user, chatId)).id);
}

/**
 * One turn of a support chat. `person: true` is the "Talk to a person" button: it hands over
 * without asking the model. Otherwise the person's message is saved first (so it survives a failed
 * turn), and the model gets at most four rounds of tools before the chat offers a person instead.
 */
export async function sendMessage(
  ctx: Ctx,
  user: User,
  input: { chatId?: string; ref?: string | null; text?: string; person?: true },
  opts: { callTimeoutMs?: number; turnBudgetMs?: number } = {},
): Promise<ChatView> {
  const model = ctx.support;
  if (!model) throw new AppError(404, "SUPPORT_OFF", `The agent isn't available right now. Email ${ctx.supportInbox}.`);
  const text = input.text?.trim() ?? "";
  if (!input.person && !text) throw badRequest("EMPTY_MESSAGE", "Write a message first");
  if (text.length > MAX_MESSAGE) throw badRequest("MESSAGE_TOO_LONG", `Keep a message under ${MAX_MESSAGE} characters`);

  let chat: Chat;
  let started = false;
  const chatKey = `support:u:${user.id}`;
  if (input.chatId) {
    chat = await ownChat(ctx, user, input.chatId);
    if (chat.status !== "open") throw conflict("CHAT_HANDED_OVER", "This chat is with the Splits team now. They'll reply by email.");
  } else {
    if (!(await hitRateLimit(ctx, chatKey, ctx.limits.supportChatsPerDay, DAY))) {
      throw tooMany("TOO_MANY_CHATS", `You've started today's ${ctx.limits.supportChatsPerDay} chats. More at ${windowEnds(ctx, DAY)} UTC, or email ${ctx.supportInbox}.`);
    }
    const ref = input.ref?.replace(/\s+/g, "").toUpperCase() || null;
    [chat] = (await ctx.db
      .insert(supportChats)
      .values({ userId: user.id, ref: ref && /^[A-Z0-9]{12}$/.test(ref) ? ref : null, status: "open" })
      .returning()) as [Chat];
    started = true;
  }

  if (input.person) return finishWithHandover(ctx, user, chat.id, "The person asked to talk to a person.");

  await say(ctx, chat.id, "person", text);
  const [{ n }] = (await ctx.db
    .select({ n: count() })
    .from(supportMessages)
    .where(and(eq(supportMessages.chatId, chat.id), eq(supportMessages.role, "person")))) as [{ n: number }];
  if (n >= MAX_PERSON_MESSAGES) return finishWithHandover(ctx, user, chat.id, LONG);

  const callAllowed = async (): Promise<"ok" | "hour" | "day"> => {
    if (!(await hitRateLimit(ctx, "support:all", ctx.limits.supportCallsGlobalPerHour, HOUR))) return "hour";
    if (!(await hitRateLimit(ctx, "support:all:day", ctx.limits.supportCallsGlobalPerDay, DAY))) return "day";
    return "ok";
  };

  const began = Date.now();
  const budget = opts.turnBudgetMs ?? 45_000;
  const turns = history(await messagesOf(ctx, chat.id));
  const used: string[] = [];
  const tokens = { input: 0, output: 0 };
  let rounds = 0;
  const log = () =>
    console.info(
      `[support] model=${model.id} rounds=${rounds} tools=${used.join(",") || "none"} tokens_in=${tokens.input} tokens_out=${tokens.output} ms=${Date.now() - began}`,
    );

  let acted = false;
  /**
   * A turn that can't finish. A new chat where nothing happened yet is taken back whole (and doesn't
   * count against the day's chats), so trying again starts clean. Otherwise the person's message
   * and any action already taken stay, and the chat says why it stopped instead of failing the request.
   */
  const stop = async (err: AppError): Promise<ChatView> => {
    log();
    if (started && !acted) {
      await ctx.db.delete(supportChats).where(eq(supportChats.id, chat.id));
      await refundRateHit(ctx, chatKey, DAY);
      throw err;
    }
    await say(ctx, chat.id, "agent", err.message);
    return view(ctx, chat.id);
  };

  while (rounds < MAX_ROUNDS) {
    const allowed = await callAllowed();
    if (allowed !== "ok") {
      return stop(tooMany("SUPPORT_BUSY", `The agent is busy right now. Try again at ${windowEnds(ctx, allowed === "hour" ? HOUR : DAY)} UTC, or email ${ctx.supportInbox}.`));
    }
    const left = budget - (Date.now() - began);
    let reply: SupportReply;
    try {
      if (left <= 0) throw new Error("timeout");
      reply = await withTimeout((signal) => model.reply(turns, { ref: chat.ref }, signal), Math.min(opts.callTimeoutMs ?? 20_000, left));
    } catch (err) {
      console.error(`[support] ${model.id} call failed: ${err instanceof Error ? `${err.name} ${err.message}` : "error"}`);
      return stop(unavailable("SUPPORT_UNAVAILABLE", TIMEOUT));
    }
    rounds++;
    tokens.input += reply.usage.input;
    tokens.output += reply.usage.output;

    if (!reply.calls.length) {
      await say(ctx, chat.id, "agent", reply.text?.trim() || "I couldn't work that out. Try asking another way, or talk to a person.");
      log();
      return view(ctx, chat.id);
    }
    const handover = reply.calls.find((c) => c.name === "hand_over");
    if (handover) {
      used.push("hand_over");
      if (reply.text?.trim()) await say(ctx, chat.id, "agent", reply.text.trim());
      const summary = (handover.input as { summary?: unknown } | null)?.summary;
      log();
      return finishWithHandover(ctx, user, chat.id, typeof summary === "string" && summary.trim() ? summary.trim().slice(0, 600) : "The agent passed this on.");
    }
    turns.push(...(reply.text?.trim() ? [{ role: "agent" as const, text: reply.text.trim() }] : []));
    for (const call of reply.calls) {
      used.push(call.name);
      const result = await runTool(ctx, user, call.name, call.input);
      // Only what actually happened gets a line of its own; a refusal is the agent's to explain.
      if (WRITES.has(call.name) && result.ok) {
        await say(ctx, chat.id, "action", result.text, call.name);
        acted = true;
      }
      turns.push({ role: "tool_call", id: call.id, name: call.name, input: call.input }, { role: "tool_result", id: call.id, text: result.text });
    }
  }
  await say(ctx, chat.id, "agent", "I couldn't sort this out here. Choose Talk to a person and the Splits team will reply by email.");
  log();
  return view(ctx, chat.id);
}
