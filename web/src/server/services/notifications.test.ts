import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notifications, users } from "../db/schema";
import { testCtx } from "../testing";
import { clearNotifications, listNotifications, markRead, notify, sendDueAlerts } from "./notifications";

async function setup() {
  const t = await testCtx({ APP_URL: "https://mysplits.xyz" });
  const [user] = await t.ctx.db.insert(users).values({ email: "ada@example.com", status: "active" }).returning();
  return { ...t, user: user! };
}

const ready = { sourceKey: "deposit:1:ready", kind: "deposit_ready", title: "Your $49.99 is ready", body: "It arrived from Base.", href: "/home", amount: "49.99", email: true };

describe("notifications", () => {
  it("records one notification per event, however often it is reported", async () => {
    const { ctx, user } = await setup();
    expect(await notify(ctx, user.id, ready)).toBe(true);
    expect(await notify(ctx, user.id, ready)).toBe(false);
    const { items, unread } = await listNotifications(ctx, user.id);
    expect(items).toHaveLength(1);
    expect(unread).toBe(1);
  });

  it("clears the feed for good, but still sends the alert emails already due", async () => {
    const { ctx, user } = await setup();
    await notify(ctx, user.id, ready);
    await notify(ctx, user.id, { ...ready, sourceKey: "deposit:2:ready", email: false });
    await clearNotifications(ctx, user.id);
    expect(await listNotifications(ctx, user.id)).toEqual({ items: [], unread: 0 });
    // The same event reported again stays cleared; a new one shows.
    await notify(ctx, user.id, ready);
    await notify(ctx, user.id, { ...ready, sourceKey: "deposit:3:ready", email: false });
    expect((await listNotifications(ctx, user.id)).items.map((i) => i.title)).toHaveLength(1);
    expect(await sendDueAlerts(ctx)).toBe(1);
  });

  it("emails only the kinds that ask for it, and nobody who turned alerts off", async () => {
    const { ctx, user } = await setup();
    await notify(ctx, user.id, { ...ready, sourceKey: "a", email: false });
    await notify(ctx, user.id, { ...ready, sourceKey: "b" });
    await ctx.db.update(users).set({ emailAlerts: false }).where(eq(users.id, user.id));
    await notify(ctx, user.id, { ...ready, sourceKey: "c" });
    const rows = await ctx.db.select().from(notifications).where(eq(notifications.userId, user.id));
    expect(Object.fromEntries(rows.map((r) => [r.sourceKey, r.email]))).toEqual({ a: "none", b: "pending", c: "none" });
  });

  it("sends each alert email once, with a link back into the app", async () => {
    const { ctx, user } = await setup();
    await notify(ctx, user.id, ready);
    const [a, b] = await Promise.all([sendDueAlerts(ctx), sendDueAlerts(ctx)]);
    expect(a + b).toBe(1);
    expect(await sendDueAlerts(ctx)).toBe(0);
    expect(ctx.previewEmail!.alerts).toEqual([
      {
        to: "ada@example.com",
        alert: { subject: "Your $49.99 is ready", title: "Your $49.99 is ready", body: "It arrived from Base.", url: "https://mysplits.xyz/home", kind: "deposit_ready", amount: "49.99" },
      },
    ]);
  });

  it("retries a failed alert later, and gives up after the last attempt", async () => {
    const { ctx, user, clock } = await setup();
    let calls = 0;
    const failing = { ...ctx, email: { ...ctx.email, sendAlert: async () => { calls++; throw new Error("provider down"); } } };
    await notify(ctx, user.id, ready);
    expect(await sendDueAlerts(failing)).toBe(0);
    expect(await sendDueAlerts(failing)).toBe(0); // backing off
    expect(calls).toBe(1);
    for (let i = 0; i < 12; i++) {
      clock.advance(60 * 60_000);
      await sendDueAlerts(failing);
    }
    const [row] = await ctx.db.select().from(notifications).where(eq(notifications.userId, user.id));
    expect(row!.email).toBe("failed");
    expect(row!.emailError).toContain("provider down");
  });

  it("lists newest first and clears the unread count when opened", async () => {
    const { ctx, user, clock } = await setup();
    await notify(ctx, user.id, { ...ready, sourceKey: "old", title: "Old" });
    clock.advance(1000);
    await notify(ctx, user.id, { ...ready, sourceKey: "new", title: "New" });
    expect((await listNotifications(ctx, user.id)).items.map((n) => n.title)).toEqual(["New", "Old"]);
    await markRead(ctx, user.id);
    expect((await listNotifications(ctx, user.id)).unread).toBe(0);
  });
});
