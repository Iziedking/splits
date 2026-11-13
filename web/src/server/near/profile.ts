/**
 * The person behind an email account: their profile picture, paying someone by their email, and
 * telling people by email that they were paid. Accounts are made by custody.ts.
 */
import { eq, inArray } from "drizzle-orm";
import { formatUnits, isAccountId, type WalletTx } from "@/lib/near/payment";
import { normaliseEmail } from "../auth/otp";
import type { Ctx } from "../context";
import { nearProfiles, users } from "../db/schema";
import { badRequest, tooMany } from "../errors";
import { hitRateLimit } from "../services/rateLimits";
import { ensureUser, type User } from "../services/users";
import { ensureNearAccount } from "./custody";

const DAY = 24 * 60 * 60_000;

/** New people one person may pay by email in a day. Each one is a NEAR account Splits pays for. */
export const NEW_RECIPIENTS_PER_DAY = 10;

/** A profile picture: a small square image as a data URL. 80,000 characters is about 60 KB. */
export const MAX_AVATAR_CHARS = 80_000;
const AVATAR = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

export function validAvatar(dataUrl: string): boolean {
  return dataUrl.length <= MAX_AVATAR_CHARS && AVATAR.test(dataUrl);
}

/** Remember which NEAR account is this person's. Safe to call on every sign-in. */
export async function recordNearAccount(ctx: Ctx, userId: string, accountId: string): Promise<void> {
  await ctx.db.insert(nearProfiles).values({ userId, accountId }).onConflictDoNothing();
}

export async function getAvatar(ctx: Ctx, userId: string): Promise<string | null> {
  const [row] = await ctx.db.select({ avatar: nearProfiles.avatar }).from(nearProfiles).where(eq(nearProfiles.userId, userId)).limit(1);
  return row?.avatar ?? null;
}

/** Sets or (with null) removes the picture. The account row exists from the person's first sign-in. */
export async function setAvatar(ctx: Ctx, userId: string, dataUrl: string | null): Promise<void> {
  if (dataUrl !== null && !validAvatar(dataUrl)) throw badRequest("BAD_PICTURE", "That picture can't be used. Choose a JPG, PNG or WebP image.");
  await ctx.db.update(nearProfiles).set({ avatar: dataUrl }).where(eq(nearProfiles.userId, userId));
}

/**
 * The account a payment to `rawEmail` goes to. Someone new gets an account now, so the money waits
 * for them; they find it when they sign in with that email. New people are capped per payer.
 */
export async function accountForEmail(ctx: Ctx, payer: User, rawEmail: string): Promise<string> {
  const email = normaliseEmail(rawEmail);
  if (email === payer.email) throw badRequest("PAY_SELF", "That's your own email.");
  const [known] = await ctx.db
    .select({ accountId: nearProfiles.accountId })
    .from(nearProfiles)
    .innerJoin(users, eq(users.id, nearProfiles.userId))
    .where(eq(users.email, email))
    .limit(1);
  if (known) return known.accountId;
  if (!(await hitRateLimit(ctx, `near:recipients:${payer.id}`, NEW_RECIPIENTS_PER_DAY, DAY))) {
    throw tooMany("NEW_RECIPIENTS_CAP", `You can pay up to ${NEW_RECIPIENTS_PER_DAY} new people by email a day. Try again tomorrow.`);
  }
  const person = await ensureUser(ctx, email, "invited");
  const accountId = await ensureNearAccount(ctx, person.id);
  await recordNearAccount(ctx, person.id, accountId);
  return accountId;
}

type Paid = { account_id: string; amount: string; purpose: string };

/** The parts of a router payment in a transaction this app relays, or nothing if it isn't one. */
export function paidLegs(tx: WalletTx, router: string): Paid[] {
  const legs: Paid[] = [];
  for (const a of tx.actions) {
    if (a.params.methodName !== "ft_transfer_call" || a.params.args.receiver_id !== router) continue;
    try {
      const msg = JSON.parse(String(a.params.args.msg)) as { legs?: unknown };
      if (!Array.isArray(msg.legs)) continue;
      for (const l of msg.legs as Partial<Paid>[]) {
        if (typeof l.account_id === "string" && isAccountId(l.account_id) && typeof l.amount === "string" && /^\d+$/.test(l.amount)) {
          legs.push({ account_id: l.account_id, amount: l.amount, purpose: typeof l.purpose === "string" ? l.purpose : "" });
        }
      }
    } catch {
      // Not a payment message.
    }
  }
  return legs;
}

/**
 * After a payment, email each Splits email person it paid, once per person: who sent it, how much,
 * and what for. The payer's own pockets are not told. Failures never undo the payment.
 */
export async function notifyPaid(ctx: Ctx, payer: User, payerAccount: string, legs: Paid[], appUrl: string): Promise<number> {
  const mine = (id: string) => id === payerAccount || id.endsWith(`.${payerAccount}`);
  const theirs = legs.filter((l) => !mine(l.account_id));
  if (!theirs.length) return 0;
  const rows = await ctx.db
    .select({ accountId: nearProfiles.accountId, email: users.email })
    .from(nearProfiles)
    .innerJoin(users, eq(users.id, nearProfiles.userId))
    .where(inArray(nearProfiles.accountId, [...new Set(theirs.map((l) => l.account_id))]));
  let sent = 0;
  for (const r of rows) {
    const parts = theirs.filter((l) => l.account_id === r.accountId);
    const total = parts.reduce((a, l) => a + BigInt(l.amount), 0n);
    const purpose = [...new Set(parts.map((l) => l.purpose).filter(Boolean))].join(", ") || "a payment";
    try {
      await ctx.email.sendPaymentNotice(r.email, { from: payer.email, amount: formatUnits(total), purpose, appUrl, url: `${appUrl}/near/app` });
      sent++;
    } catch {
      // The money landed either way; the person sees it when they sign in.
    }
  }
  return sent;
}
