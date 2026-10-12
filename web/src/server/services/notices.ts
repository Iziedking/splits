import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import type { Ctx } from "../context";
import { notices, transfers, users } from "../db/schema";
import { greetingName } from "../../lib/format";
import { formatUsdc } from "../domain/money";
import type { Transfer } from "./transfers";

export const MAX_NOTICE_ATTEMPTS = 8;
/** First retry after 30s, doubling each time, never more than an hour apart: 8 tries span ~2h. */
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 60 * 60_000;
/** Kept under the email provider's per-second limit; a giveaway's notices go out over a few sweeps. */
const PER_SWEEP = 5;
const LIVE_GAP_MS = 300;

/** Queues one "you received money" email per email recipient of a settled payment. Safe to repeat. */
export async function queueNotices(ctx: Ctx, t: Transfer): Promise<number> {
  if (t.status !== "settled" || (t.kind !== "send" && t.kind !== "pay")) return 0;
  const [payer] = t.payerUserId
    ? await ctx.db.select({ email: users.email }).from(users).where(eq(users.id, t.payerUserId)).limit(1)
    : [];
  const rows: (typeof notices.$inferInsert)[] = t.expected
    .filter((l) => l.email && l.email !== payer?.email && BigInt(l.amount) > 0n)
    .map((l) => ({ transferId: t.id, email: l.email!, amount: l.amount, purpose: l.purpose }));
  // Paid from a wallet without an account: the email given at payment gets the receipt link, by
  // itself, once it lands (the "Email me my receipt" button stays for anyone who didn't give one).
  if (!t.payerUserId && t.visitorEmail && t.visitorToken) {
    rows.push({ transferId: t.id, kind: "payer_receipt", email: t.visitorEmail, amount: (BigInt(t.amount) + BigInt(t.feeAmount)).toString(), purpose: "receipt" });
  }
  if (rows.length === 0) return 0;
  const inserted = await ctx.db.insert(notices).values(rows).onConflictDoNothing().returning({ id: notices.id });
  return inserted.length;
}

/**
 * Sends notices that are due. A failure is recorded and retried later with backoff; a rate limit
 * is retried soon without counting as an attempt. None of this ever touches the payment.
 */
export async function sendDueNotices(ctx: Ctx, limit = PER_SWEEP): Promise<{ sent: number; failed: number }> {
  const now = ctx.now();
  const due = await ctx.db
    .select({ n: notices, from: users.email, payerAddress: transfers.payerAddress, visitorEmail: transfers.visitorEmail, visitorToken: transfers.visitorToken })
    .from(notices)
    .innerJoin(transfers, eq(transfers.id, notices.transferId))
    .leftJoin(users, eq(users.id, transfers.payerUserId))
    .where(
      and(
        eq(notices.status, "pending"),
        lt(notices.attempts, MAX_NOTICE_ATTEMPTS),
        or(isNull(notices.nextAttemptAt), lte(notices.nextAttemptAt, now)),
      ),
    )
    .orderBy(notices.createdAt)
    .limit(Math.min(limit, PER_SWEEP));

  let sent = 0;
  let failed = 0;
  for (const [i, { n, from, payerAddress, visitorEmail, visitorToken }] of due.entries()) {
    if (i > 0 && ctx.mode === "live") await new Promise((r) => setTimeout(r, LIVE_GAP_MS));
    // Claim the notice first, so two sweeps running at once can't both send it.
    const [claimed] = await ctx.db
      .update(notices)
      .set({ attempts: n.attempts + 1 })
      .where(and(eq(notices.id, n.id), eq(notices.status, "pending"), eq(notices.attempts, n.attempts)))
      .returning({ id: notices.id });
    if (!claimed) continue;
    try {
      if (n.kind === "payer_receipt") {
        await ctx.email.sendReceiptLink(n.email, { amount: formatUsdc(BigInt(n.amount)), url: `${ctx.appUrl}/p/${visitorToken}` });
      } else await ctx.email.sendPaymentNotice(n.email, {
        from: from ?? (visitorEmail ? greetingName(visitorEmail) : `${payerAddress.slice(0, 6)}…${payerAddress.slice(-4)}`),
        amount: formatUsdc(BigInt(n.amount)),
        purpose: n.purpose,
        appUrl: ctx.appUrl,
      });
      await ctx.db.update(notices).set({ status: "sent", sentAt: ctx.now() }).where(eq(notices.id, n.id));
      sent++;
    } catch (err) {
      failed++;
      const rateLimited = err instanceof Error && err.name === "RateLimited";
      const attempts = rateLimited ? n.attempts : n.attempts + 1;
      const wait = rateLimited ? 10_000 : Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS);
      await ctx.db
        .update(notices)
        .set({
          attempts,
          status: attempts >= MAX_NOTICE_ATTEMPTS ? "failed" : "pending",
          nextAttemptAt: new Date(ctx.now().getTime() + wait),
          lastError: err instanceof Error ? err.message.slice(0, 300) : "Unknown error",
        })
        .where(eq(notices.id, n.id));
      // The provider asked us to slow down: leave the rest of this batch for the next sweep.
      if (rateLimited) break;
    }
  }
  return { sent, failed };
}
