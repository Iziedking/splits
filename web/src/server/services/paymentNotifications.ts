import { eq, sql } from "drizzle-orm";
import type { Ctx } from "../context";
import { users, wallets } from "../db/schema";
import { formatUsdc } from "../domain/money";
import { notify } from "./notifications";
import { chargeOf, type Transfer } from "./transfers";

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * What a settled or failed payment means for the people in it: the payer hears it landed (or that
 * nothing was sent), and everyone paid who has a Splits account sees what they received. Each event
 * is keyed, so advancing the same payment again tells nobody twice. Visitors have no account and
 * keep their own status link instead.
 */
export async function notifyPaymentOutcome(ctx: Ctx, t: Transfer): Promise<void> {
  if (t.status !== "settled" && t.status !== "failed") return;
  const legs = t.expected.filter((l) => BigInt(l.amount) > 0n);
  const charged = formatUsdc(chargeOf(t));

  if (t.payerUserId) {
    if (t.status === "failed" && t.lastError?.includes("Flagged for review")) {
      // The router call went through but its receipt didn't match: money may have moved.
      await notify(ctx, t.payerUserId, {
        sourceKey: `transfer:${t.id}:failed`,
        kind: "payment_failed",
        title: "Payment flagged for review",
        body: `Your $${charged} payment went out but didn't match what you approved. Splits is checking it.`,
        href: `/payments/${t.id}`,
        amount: charged,
        email: true,
      });
      return;
    }
    if (t.status === "failed") {
      await notify(ctx, t.payerUserId, {
        sourceKey: `transfer:${t.id}:failed`,
        kind: "payment_failed",
        title: "Payment not sent",
        body: `Your $${charged} payment didn't go through. No one was paid.`,
        href: `/payments/${t.id}`,
        amount: charged,
        email: true,
      });
      return;
    }
    if (t.kind === "auto") {
      await notify(ctx, t.payerUserId, {
        sourceKey: `auto:${t.id}`,
        kind: "auto_split",
        title: `Your automatic split moved $${formatUsdc(BigInt(t.amount))}`,
        body: `To ${legs.map((l) => l.name).join(", ")}.`,
        href: "/home",
        amount: formatUsdc(BigInt(t.amount)),
        email: false,
      });
    } else {
      await notify(ctx, t.payerUserId, {
        sourceKey: `transfer:${t.id}:settled`,
        kind: "payment_landed",
        title: `Landed: $${charged} reached ${legs.length === 1 ? legs[0]!.name : `${legs.length} people`}`,
        body: "Each person has a receipt.",
        href: `/payments/${t.id}`,
        amount: charged,
        email: true,
      });
    }
  }
  if (t.status !== "settled") return;

  const [payer] = t.payerUserId ? await ctx.db.select({ email: users.email }).from(users).where(eq(users.id, t.payerUserId)).limit(1) : [];
  const from = payer?.email ?? short(t.payerAddress);
  for (const leg of legs) {
    const [owner] = await ctx.db
      .select({ userId: wallets.userId })
      .from(wallets)
      .where(eq(sql`lower(${wallets.address})`, leg.address.toLowerCase()))
      .limit(1);
    if (!owner || owner.userId === t.payerUserId) continue;
    await notify(ctx, owner.userId, {
      sourceKey: `received:${t.id}:${owner.userId}`,
      kind: "payment_received",
      title: `You received $${formatUsdc(BigInt(leg.amount))}`,
      body: `From ${from}, for "${leg.purpose}".`,
      href: "/home",
      amount: formatUsdc(BigInt(leg.amount)),
      // Email recipients already get the "you received money" email.
      email: false,
    });
  }
}
