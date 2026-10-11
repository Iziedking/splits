import { and, eq } from "drizzle-orm";
import type { Ctx } from "../context";
import { providerTxs } from "../db/schema";
import { deterministicUuid } from "../domain/ids";

export type ProviderTxRow = typeof providerTxs.$inferSelect;

/**
 * Sends a write to the wallet provider at most once per (subject, step, attempt). The idempotency
 * key is derived from those three, so if the process dies after the provider accepted the call but
 * before the row was saved, the next run sends the same key and gets the original transaction back.
 */
export async function submitOnce(
  ctx: Ctx,
  subjectId: string,
  step: string,
  attempt: number,
  send: (idempotencyKey: string) => Promise<{ providerTxId: string }>,
): Promise<ProviderTxRow> {
  const existing = await findProviderTx(ctx, subjectId, step, attempt);
  if (existing) return existing;

  const idempotencyKey = deterministicUuid(`${subjectId}:${step}:${attempt}`);
  const { providerTxId } = await send(idempotencyKey);
  await ctx.db
    .insert(providerTxs)
    .values({ subjectId, step, attempt, idempotencyKey, providerTxId, status: "pending", rawState: "SUBMITTED" })
    .onConflictDoNothing();
  const row = await findProviderTx(ctx, subjectId, step, attempt);
  if (!row) throw new Error(`provider tx ${subjectId}/${step}/${attempt} missing after insert`);
  return row;
}

export async function findProviderTx(ctx: Ctx, subjectId: string, step: string, attempt = 1) {
  const [row] = await ctx.db
    .select()
    .from(providerTxs)
    .where(and(eq(providerTxs.subjectId, subjectId), eq(providerTxs.step, step), eq(providerTxs.attempt, attempt)))
    .limit(1);
  return row;
}

/** Asks the provider for news on a pending write and stores it. Final rows are returned as-is. */
export async function refreshProviderTx(ctx: Ctx, row: ProviderTxRow): Promise<ProviderTxRow> {
  if (row.status !== "pending") return row;
  const tx = await ctx.wallets.getTx(row.providerTxId);
  const [updated] = await ctx.db
    .update(providerTxs)
    .set({
      status: tx.status,
      rawState: tx.rawState,
      txHash: tx.txHash ?? row.txHash,
      error: tx.error ?? null,
      updatedAt: ctx.now(),
    })
    .where(eq(providerTxs.id, row.id))
    .returning();
  return updated!;
}
