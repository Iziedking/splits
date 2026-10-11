import { and, isNotNull, isNull, lt } from "drizzle-orm";
import type { Ctx } from "../context";
import { payoutDrafts, rateHits } from "../db/schema";

const HOUR = 60 * 60_000;
/** Rate windows are an hour at most; two days covers every window still in use. */
const RATE_HITS_KEEP_MS = 48 * HOUR;
/** A visitor's unpaid list is useless 30 minutes after it was checked; keep a day for support. */
const DRAFTS_KEEP_MS = 24 * HOUR;

/**
 * Deletes what no one can use any more: old rate-limit counters, and visitors' lists that expired
 * unpaid. Paid lists stay (a payment points at its list). Safe to run any number of times.
 */
export async function pruneStale(ctx: Ctx): Promise<{ rateHits: number; drafts: number }> {
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
  return { rateHits: hits.length, drafts: drafts.length };
}
