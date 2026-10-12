import { and, count, desc, eq, isNull, lt, lte, or } from "drizzle-orm";
import type { Ctx } from "../context";
import { notifications, users } from "../db/schema";

export type NotificationInput = {
  /** One notification per event: the same key twice is the same event (replays, retries). */
  sourceKey: string;
  kind: string;
  title: string;
  body: string;
  href?: string;
  amount?: string;
  /** Also email it (only the moments that matter, per the spec's table). */
  email: boolean;
};

const MAX_EMAIL_ATTEMPTS = 8;
const PER_SWEEP = 5;
const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000);

/** Records what happened to someone's money. True when it is new. */
export async function notify(ctx: Ctx, userId: string, n: NotificationInput): Promise<boolean> {
  const [user] = await ctx.db.select({ emailAlerts: users.emailAlerts }).from(users).where(eq(users.id, userId)).limit(1);
  const rows = await ctx.db
    .insert(notifications)
    .values({
      userId,
      sourceKey: n.sourceKey,
      kind: n.kind,
      title: n.title,
      body: n.body,
      href: n.href ?? null,
      amount: n.amount ?? null,
      email: n.email && user?.emailAlerts ? "pending" : "none",
      createdAt: ctx.now(),
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return rows.length > 0;
}

export async function listNotifications(ctx: Ctx, userId: string, limit = 50) {
  const items = await ctx.db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      amount: notifications.amount,
      read: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.clearedAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  const [unread] = await ctx.db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), isNull(notifications.clearedAt)));
  return {
    items: items.map((i) => ({ ...i, read: i.read !== null, createdAt: i.createdAt.toISOString() })),
    unread: Number(unread?.n ?? 0),
  };
}

export async function markRead(ctx: Ctx, userId: string): Promise<void> {
  await ctx.db.update(notifications).set({ readAt: ctx.now() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

/** "Clear all": empties the person's feed. Alert emails already due still go out. */
export async function clearNotifications(ctx: Ctx, userId: string): Promise<void> {
  await markRead(ctx, userId);
  await ctx.db
    .update(notifications)
    .set({ clearedAt: ctx.now() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.clearedAt)));
}

/**
 * Sends pending alert emails, each at most once: a row is claimed by bumping its attempt count
 * from the value read, so two sweepers never send the same one. Failures back off and give up.
 */
export async function sendDueAlerts(ctx: Ctx, limit = PER_SWEEP): Promise<number> {
  const now = ctx.now();
  const due = await ctx.db
    .select({ n: notifications, to: users.email })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(
      and(
        eq(notifications.email, "pending"),
        lt(notifications.emailAttempts, MAX_EMAIL_ATTEMPTS),
        or(isNull(notifications.emailNextAt), lte(notifications.emailNextAt, now)),
      ),
    )
    .orderBy(notifications.createdAt)
    .limit(limit);

  let sent = 0;
  for (const { n, to } of due) {
    const attempts = n.emailAttempts + 1;
    const [claimed] = await ctx.db
      .update(notifications)
      .set({ emailAttempts: attempts, emailNextAt: new Date(now.getTime() + backoffMs(attempts)) })
      .where(and(eq(notifications.id, n.id), eq(notifications.email, "pending"), eq(notifications.emailAttempts, n.emailAttempts)))
      .returning({ id: notifications.id });
    if (!claimed) continue;
    try {
      await ctx.email.sendAlert(to, {
        subject: n.title,
        title: n.title,
        body: n.body,
        url: n.href ? `${ctx.appUrl}${n.href}` : null,
        kind: n.kind,
        amount: n.amount,
      });
      await ctx.db.update(notifications).set({ email: "sent", emailError: null }).where(eq(notifications.id, n.id));
      sent++;
    } catch (err) {
      await ctx.db
        .update(notifications)
        .set({ email: attempts >= MAX_EMAIL_ATTEMPTS ? "failed" : "pending", emailError: String(err instanceof Error ? err.message : err).slice(0, 300) })
        .where(eq(notifications.id, n.id));
    }
  }
  return sent;
}
