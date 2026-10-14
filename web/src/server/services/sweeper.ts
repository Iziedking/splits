import { and, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../context";
import { actions, splits } from "../db/schema";
import { pruneStale } from "./housekeeping";
import { advanceDeposits, pollDepositWallets } from "./deposits";
import { sweepEarn } from "./earn";
import { openMissingDepositWallets } from "./depositWallets";
import { sendDueAlerts } from "./notifications";
import { sendDueNotices } from "./notices";
import { advanceWithRules } from "./rules";
import { advanceSplit } from "./splits";
import { activeTransferIds, openReservationIds } from "./transfers";
import { findLatePayments } from "./visitorPayments";

export type SweepResult = { transfers: number; splits: number; errors: number };

/** Clean-up of old counters and unused visitor lists runs at most this often per server. */
const PRUNE_EVERY_MS = 60 * 60_000;
let lastPrune = 0;

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

  for (const id of await openReservationIds(ctx, limit)) {
    try {
      await advanceWithRules(ctx, id);
      result.transfers++;
    } catch (err) {
      result.errors++;
      console.error(`[sweep] reservation ${id}`, err);
    }
  }

  try {
    result.transfers += await findLatePayments(ctx, limit);
  } catch (err) {
    result.errors++;
    console.error("[sweep] late visitor payments", err);
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

  if (ctx.now().getTime() - lastPrune >= PRUNE_EVERY_MS) {
    lastPrune = ctx.now().getTime();
    try {
      await pruneStale(ctx);
    } catch (err) {
      result.errors++;
      console.error("[sweep] housekeeping", err);
    }
  }

  try {
    await sendDueNotices(ctx, limit);
  } catch (err) {
    result.errors++;
    console.error("[sweep] notices", err);
  }

  try {
    await sendDueAlerts(ctx);
  } catch (err) {
    result.errors++;
    console.error("[sweep] alerts", err);
  }

  try {
    await sweepEarn(ctx, limit);
  } catch (err) {
    result.errors++;
    console.error("[sweep] earn", err);
  }

  // Deposits from other chains last: they read other chains' RPCs, which can be slow, and must not
  // hold up payments, notices or alerts. Find new ones (backup for webhooks), then move them to Arc.
  try {
    await openMissingDepositWallets(ctx);
    await pollDepositWallets(ctx);
    await advanceDeposits(ctx);
  } catch (err) {
    result.errors++;
    console.error("[sweep] deposits", err);
  }
  return result;
}
