import { createPublicKey, verify } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../context";
import { depositWallets, providerTxs, transfers, wallets, webhookEvents } from "../db/schema";
import { deterministicUuid } from "../domain/ids";
import { MoneyError, parseUsdc } from "../domain/money";
import { forbidden } from "../errors";
import { inboundStateOk } from "../wallets/circle";
import { recordInbound } from "./deposits";
import { notifyPaymentOutcome } from "./paymentNotifications";
import { createAutoTransfer } from "./rules";
import { advanceTransfer } from "./transfers";

/** ECDSA P-256 / SHA-256 over the raw body, as Circle documents. Never re-serialise the JSON first. */
export function verifyCircleSignature(rawBody: string, signatureB64: string, publicKeyB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
    return verify("sha256", Buffer.from(rawBody, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

const envelope = z.object({
  notificationId: z.string().min(1),
  notificationType: z.string(),
  notification: z.record(z.string(), z.unknown()),
});

const inbound = z.object({
  id: z.string(),
  walletId: z.string(),
  state: z.string(),
  transactionType: z.string().optional(),
  amounts: z.array(z.string()).min(1),
  txHash: z.string().optional(),
});

export type WebhookOutcome = "ignored" | "duplicate" | "processed";

export async function handleCircleWebhook(
  ctx: Ctx,
  rawBody: string,
  headers: { signature: string | null; keyId: string | null },
): Promise<WebhookOutcome> {
  if (!headers.signature || !headers.keyId) throw forbidden("WEBHOOK_UNSIGNED", "Missing signature");
  const publicKey = await ctx.webhookKey(headers.keyId);
  if (!verifyCircleSignature(rawBody, headers.signature, publicKey)) {
    throw forbidden("WEBHOOK_SIGNATURE", "Bad signature");
  }

  const parsed = envelope.safeParse(JSON.parse(rawBody));
  if (!parsed.success) return "ignored";
  const event = parsed.data;

  const first = await ctx.db
    .insert(webhookEvents)
    .values({ notificationId: event.notificationId, type: event.notificationType })
    .onConflictDoNothing()
    .returning();
  if (first.length === 0) return "duplicate";

  if (event.notificationType !== "transactions.inbound") return "ignored";
  const tx = inbound.safeParse(event.notification);
  if (!tx.success) return "ignored";

  // Money arriving on another chain: a deposit to move to Arc. It is checked on that chain first,
  // so Circle's earlier CONFIRMED state is enough to start.
  const [deposit] = await ctx.db.select({ id: depositWallets.id }).from(depositWallets).where(eq(depositWallets.providerWalletId, tx.data.walletId)).limit(1);
  if (deposit) {
    if (!tx.data.txHash || !inboundStateOk(tx.data.state, true)) return "ignored";
    try {
      return (await recordInbound(ctx, { walletId: tx.data.walletId, txHash: tx.data.txHash as `0x${string}` })) === "ignored" ? "ignored" : "processed";
    } catch (err) {
      // The chain couldn't be read: forget this delivery so Circle's retry is handled, not a duplicate.
      await ctx.db.delete(webhookEvents).where(eq(webhookEvents.notificationId, event.notificationId));
      throw err;
    }
  }
  // Money arriving on Arc runs the person's rules only once it is final.
  if (!inboundStateOk(tx.data.state, false)) return "ignored";

  const [wallet] = await ctx.db.select().from(wallets).where(eq(wallets.providerWalletId, tx.data.walletId)).limit(1);
  if (!wallet) return "ignored";

  // Money that arrived through our own router or top-ups is handled when that payment settles.
  if (tx.data.txHash) {
    const ours = await ctx.db
      .select({ id: providerTxs.id })
      .from(providerTxs)
      .where(eq(providerTxs.txHash, tx.data.txHash))
      .limit(1);
    const ourTransfer = await ctx.db
      .select({ id: transfers.id })
      .from(transfers)
      .where(or(eq(transfers.txHash, tx.data.txHash)))
      .limit(1);
    if (ours.length > 0 || ourTransfer.length > 0) return "ignored";
  }

  let amount: bigint;
  try {
    amount = parseUsdc(tx.data.amounts[0]!);
  } catch (err) {
    if (err instanceof MoneyError) return "ignored";
    throw err;
  }

  const childId = await createAutoTransfer(ctx, wallet, amount, deterministicUuid(`inbound:${tx.data.id}`));
  if (childId) await notifyPaymentOutcome(ctx, await advanceTransfer(ctx, childId));
  return "processed";
}
