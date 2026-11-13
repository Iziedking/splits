/**
 * The person behind an email account: their profile picture, paying someone by their email, and
 * telling people by email that they were paid. Accounts are made by custody.ts.
 */
import { eq, inArray } from "drizzle-orm";
import { NEAR } from "@/lib/near/config";
import { formatUnits, isAccountId, type WalletTx } from "@/lib/near/payment";
import { normaliseEmail } from "../auth/otp";
import type { Ctx } from "../context";
import { nearContacts, nearProfiles, users } from "../db/schema";
import { badRequest, tooMany } from "../errors";
import { hitRateLimit } from "../services/rateLimits";
import { ensureUser } from "../services/users";
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
 * Who is asking to pay by email: a signed-in email person (their contacts are kept, so names show on
 * every device they use), or a NEAR wallet, capped by where the request comes from.
 */
export type Payer = { userId: string; email: string } | { wallet: string; ip: string };

/**
 * The account a payment to `rawEmail` goes to. Someone new gets an account now, so the money waits
 * for them; they find it when they sign in with that email. New people are capped per payer.
 */
export async function accountForEmail(ctx: Ctx, payer: Payer, rawEmail: string): Promise<string> {
  const email = normaliseEmail(rawEmail);
  if ("email" in payer && email === payer.email) throw badRequest("PAY_SELF", "That's your own email.");
  const accountId = await findOrMake(ctx, payer, email);
  if ("userId" in payer) {
    await ctx.db.insert(nearContacts).values({ ownerId: payer.userId, accountId, email }).onConflictDoNothing();
  }
  return accountId;
}

async function findOrMake(ctx: Ctx, payer: Payer, email: string): Promise<string> {
  const [known] = await ctx.db
    .select({ accountId: nearProfiles.accountId })
    .from(nearProfiles)
    .innerJoin(users, eq(users.id, nearProfiles.userId))
    .where(eq(users.email, email))
    .limit(1);
  if (known) return known.accountId;
  const key = "userId" in payer ? `near:recipients:${payer.userId}` : `near:recipients:ip:${payer.ip}`;
  if (!(await hitRateLimit(ctx, key, NEW_RECIPIENTS_PER_DAY, DAY))) {
    throw tooMany("NEW_RECIPIENTS_CAP", `You can pay up to ${NEW_RECIPIENTS_PER_DAY} new people by email a day. Try again tomorrow.`);
  }
  const person = await ensureUser(ctx, email, "invited");
  const accountId = await ensureNearAccount(ctx, person.id);
  await recordNearAccount(ctx, person.id, accountId);
  return accountId;
}

/** The email behind a Splits email account, for naming the payer on a receipt. */
export async function emailForAccount(ctx: Ctx, accountId: string): Promise<string | null> {
  const [row] = await ctx.db.select({ email: users.email }).from(nearProfiles).innerJoin(users, eq(users.id, nearProfiles.userId)).where(eq(nearProfiles.accountId, accountId)).limit(1);
  return row?.email ?? null;
}

/** The people a signed-in person paid by email, as account -> email, for showing names. */
export async function contactsOf(ctx: Ctx, userId: string): Promise<Record<string, string>> {
  const rows = await ctx.db.select({ accountId: nearContacts.accountId, email: nearContacts.email }).from(nearContacts).where(eq(nearContacts.ownerId, userId)).limit(500);
  return Object.fromEntries(rows.map((r) => [r.accountId, r.email]));
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
export async function notifyPaid(ctx: Ctx, from: string, payerAccount: string, legs: Paid[], appUrl: string): Promise<number> {
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
      await ctx.email.sendPaymentNotice(r.email, { from, amount: formatUnits(total), purpose, appUrl, url: `${appUrl}/near/app` });
      sent++;
    } catch {
      // The money landed either way; the person sees it when they sign in.
    }
  }
  return sent;
}

type TxStatus = {
  status?: { SuccessValue?: string; Failure?: unknown };
  transaction?: { signer_id: string; receiver_id: string; actions: ({ FunctionCall?: { method_name: string; args: string; deposit: string } } | string)[] };
};

/**
 * The parts of a router payment a NEAR wallet sent, read back from the chain, or nothing if the
 * transaction failed, isn't theirs or isn't a payment. Nobody can claim someone else's payment.
 */
export async function walletPayment(hash: string, payer: string, fetcher: typeof fetch = fetch): Promise<Paid[]> {
  const res = await fetcher(NEAR.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "splits", method: "EXPERIMENTAL_tx_status", params: { tx_hash: hash, sender_account_id: payer, wait_until: "FINAL" } }),
  });
  const out = (await res.json().catch(() => null)) as { result?: TxStatus } | null;
  const tx = out?.result?.transaction;
  if (!tx || out?.result?.status?.SuccessValue === undefined || tx.signer_id !== payer || tx.receiver_id !== NEAR.token) return [];
  const asWalletTx: WalletTx = {
    receiverId: tx.receiver_id,
    actions: tx.actions.flatMap((a) => {
      if (typeof a === "string" || !a.FunctionCall) return [];
      try {
        const args = JSON.parse(Buffer.from(a.FunctionCall.args, "base64").toString()) as Record<string, unknown>;
        return [{ type: "FunctionCall" as const, params: { methodName: a.FunctionCall.method_name, args, gas: "0", deposit: a.FunctionCall.deposit } }];
      } catch {
        return [];
      }
    }),
  };
  return paidLegs(asWalletTx, NEAR.router);
}

/** Tells the people a wallet payment paid by email, once per transaction. */
export async function notifyWalletPayment(ctx: Ctx, hash: string, payer: string, appUrl: string, fetcher: typeof fetch = fetch): Promise<number> {
  const legs = await walletPayment(hash, payer, fetcher);
  if (!legs.length) return 0;
  if (!(await hitRateLimit(ctx, `near:notified:${hash}`, 1, 100 * 365 * DAY))) return 0;
  return notifyPaid(ctx, payer, payer, legs, appUrl);
}
