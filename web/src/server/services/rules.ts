import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Address } from "viem";
import type { Ctx } from "../context";
import { splits, transfers } from "../db/schema";
import { CENT } from "../domain/allocation";
import { transferRef } from "../domain/ids";
import { queueNotices } from "./notices";
import { expectedAmounts } from "./splits";
import { advanceTransfer, type Transfer } from "./transfers";
import { walletByAddress, type Wallet } from "./users";

/**
 * Receiver-side splits. When money lands in a wallet that has an automatic split, a new payment
 * runs that split on the amount that arrived. The user approved it with their PIN when they made
 * the rule, so it needs no second confirmation.
 *
 * Loop guard: automatic payments never trigger further rules, and a payer never triggers its own.
 */
export async function createAutoTransfer(
  ctx: Ctx,
  wallet: Wallet,
  amount: bigint,
  parentTransferId: string,
): Promise<string | null> {
  // The router works in whole cents; any fraction of a cent stays in the wallet.
  amount = (amount / CENT) * CENT;
  if (amount === 0n || amount < ctx.limits.autoSplitMin) return null;
  const [rule] = await ctx.db
    .select()
    .from(splits)
    .where(and(eq(splits.autoForWalletId, wallet.id), eq(splits.status, "active")))
    .limit(1);
  if (!rule) return null;

  let expected;
  try {
    expected = expectedAmounts(rule, amount).map((l) => ({ ...l, amount: l.amount.toString() }));
  } catch {
    // A fixed-only rule can't take an arbitrary amount; the money simply stays in the wallet.
    return null;
  }

  const id = randomUUID();
  const inserted = await ctx.db
    .insert(transfers)
    .values({
      id,
      payerUserId: wallet.userId,
      payerWalletId: wallet.id,
      payerAddress: wallet.address,
      funding: "balance",
      kind: "auto",
      splitId: rule.id,
      splitVersion: rule.version,
      amount: amount.toString(),
      topUp: "0",
      expected,
      ref: transferRef(id),
      status: "confirmed",
      parentTransferId,
      createdAt: ctx.now(),
      updatedAt: ctx.now(),
    })
    .onConflictDoNothing()
    .returning({ id: transfers.id });
  if (inserted[0]) return inserted[0].id;

  const [existing] = await ctx.db
    .select({ id: transfers.id })
    .from(transfers)
    .where(and(eq(transfers.parentTransferId, parentTransferId), eq(transfers.payerWalletId, wallet.id)))
    .limit(1);
  return existing?.id ?? null;
}

export async function triggerRules(ctx: Ctx, parent: Transfer): Promise<string[]> {
  if ((parent.kind !== "send" && parent.kind !== "pay") || parent.status !== "settled") return [];
  const received = new Map<string, bigint>();
  for (const leg of parent.expected) {
    const amount = BigInt(leg.amount);
    if (amount > 0n) received.set(leg.address, (received.get(leg.address) ?? 0n) + amount);
  }
  const created: string[] = [];
  for (const [address, amount] of received) {
    const wallet = await walletByAddress(ctx, address as Address);
    if (!wallet || wallet.id === parent.payerWalletId) continue;
    const id = await createAutoTransfer(ctx, wallet, amount, parent.id);
    if (id) created.push(id);
  }
  return created;
}

/**
 * Advance a payment and, once it settles, start and advance any automatic splits it feeds.
 * `budgetMs` bounds how long this call works before answering; the sweeper carries on after it.
 */
export async function advanceWithRules(ctx: Ctx, transferId: string, budgetMs?: number): Promise<Transfer> {
  const t = await advanceTransfer(ctx, transferId, budgetMs);
  if (t.status === "settled") {
    await queueNotices(ctx, t);
    for (const childId of await triggerRules(ctx, t)) {
      await advanceTransfer(ctx, childId);
    }
  }
  return t;
}
