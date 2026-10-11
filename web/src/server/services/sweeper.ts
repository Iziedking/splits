import { and, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../context";
import { actions, splits } from "../db/schema";
import { sendDueNotices } from "./notices";
import { advanceWithRules } from "./rules";
import { advanceSplit } from "./splits";
import { activeTransferIds } from "./transfers";

export type SweepResult = { transfers: number; splits: number; errors: number };

/**
 * Pushes forward every payment and split that still has work to do, so nothing stalls when the
 * user closes the app or an automatic split has nobody watching it. Runs on an interval in a
 * long-lived server and from the cron route. Safe to overlap with itself and with user polls.
 */
export async function sweep(ctx: Ctx, limit = 25): Promise<SweepResult> {
  const result: SweepResult = { transfers: 0, splits: 0, errors: 0 };

  for (const id of await activeTransferIds(ctx, limit)) {
    try {
      await advanceWithRules(ctx, id);
      result.transfers++;
    } catch (err) {
      result.errors++;
      console.error(`[sweep] transfer ${id}`, err);
    }
  }

  const confirmed = ctx.db
    .select({ id: actions.subjectId })
    .from(actions)
    .where(and(eq(actions.type, "create_split"), eq(actions.status, "confirmed")));
  const pending = await ctx.db
    .select({ id: splits.id })
    .from(splits)
    .where(and(eq(splits.status, "pending"), inArray(splits.id, confirmed)))
    .limit(limit);
  for (const { id } of pending) {
    try {
      await advanceSplit(ctx, id);
      result.splits++;
    } catch (err) {
      result.errors++;
      console.error(`[sweep] split ${id}`, err);
    }
  }

  try {
    await sendDueNotices(ctx, limit);
  } catch (err) {
    result.errors++;
    console.error("[sweep] notices", err);
  }
  return result;
}
