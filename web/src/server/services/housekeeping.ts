import { and, isNotNull, isNull, lt } from "drizzle-orm";
import type { Ctx } from "../context";
import { payoutDrafts, rateHits, supportChats } from "../db/schema";

const HOUR = 60 * 60_000;
/** Rate windows are an hour at most; two days covers every window still in use. */
const RATE_HITS_KEEP_MS = 48 * HOUR;
/** A visitor's unpaid list is useless 30 minutes after it was checked; keep a day for support. */
const DRAFTS_KEEP_MS = 24 * HOUR;
/** Support chats are kept 90 days, long enough to follow up on, then deleted with their messages. */
const SUPPORT_CHATS_KEEP_MS = 90 * 24 * HOUR;

/**
 * Deletes what no one can use any more: old rate-limit counters, visitors' lists that expired
 * unpaid, and support chats past 90 days. Paid lists stay (a payment points at its list). Safe to run any number of times.
 */
export async function pruneStale(ctx: Ctx): Promise<{ rateHits: number; drafts: number; supportChats: number }> {
  const now = ctx.now().getTime();
  const hits = await ctx.db
    .delete(rateHits)
    .where(lt(rateHits.windowStart, new Date(now - RATE_HITS_KEEP_MS)))
    .returning({ key: rateHits.key });
  const drafts = await ctx.db
    .delete(payoutDrafts)
    .where(
      and(
        isNotNull(payoutDrafts.visitorKeyHash),
        isNull(payoutDrafts.consumedAt),
        lt(payoutDrafts.expiresAt, new Date(now - DRAFTS_KEEP_MS)),
      ),
    )
    .returning({ id: payoutDrafts.id });
  const chats = await ctx.db
    .delete(supportChats)
    .where(lt(supportChats.createdAt, new Date(now - SUPPORT_CHATS_KEEP_MS)))
    .returning({ id: supportChats.id });
  return { rateHits: hits.length, drafts: drafts.length, supportChats: chats.length };
}
