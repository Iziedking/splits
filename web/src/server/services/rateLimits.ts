import { sql } from "drizzle-orm";
import type { Ctx } from "../context";
import { rateHits } from "../db/schema";

/** Counts one hit for `key` in the current fixed window. True while the count is within `limit`. */
export async function hitRateLimit(ctx: Ctx, key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = ctx.now().getTime();
  const windowStart = new Date(now - (now % windowMs));
  const [row] = await ctx.db
    .insert(rateHits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [rateHits.key, rateHits.windowStart], set: { count: sql`${rateHits.count} + 1` } })
    .returning({ count: rateHits.count });
  return (row?.count ?? Number.POSITIVE_INFINITY) <= limit;
}
