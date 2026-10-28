import { consumeLoginCode, issueLoginCode, normaliseEmail } from "../auth/otp";
import { createSession } from "../auth/sessions";
import type { Ctx } from "../context";
import { badRequest, tooMany } from "../errors";
import { hitRateLimit } from "./rateLimits";
import { ensureMainWallet, ensureUser } from "./users";

const HOUR = 60 * 60_000;
const CODES_PER_EMAIL_PER_HOUR = 5;

/**
 * Sends a 6-digit code. In preview, or on testnet with EMAIL_PROVIDER=screen, the code is returned for the screen.
 * Counted with atomic hits per address, per client IP (when behind our proxy) and in total, so parallel
 * requests can't send more codes than the limits allow.
 */
export async function startSignIn(ctx: Ctx, rawEmail: string, ip: string | null = null): Promise<{ previewCode?: string }> {
  const email = normaliseEmail(rawEmail);
  const allowed = [
    await hitRateLimit(ctx, `signin:email:${email}`, CODES_PER_EMAIL_PER_HOUR, HOUR),
    ip === null || (await hitRateLimit(ctx, `signin:ip:${ip}`, ctx.limits.signinCodesPerIpPerHour, HOUR)),
    await hitRateLimit(ctx, "signin:all", ctx.limits.signinCodesGlobalPerHour, HOUR),
  ];
  if (allowed.includes(false)) throw tooMany("TOO_MANY_CODES", "Too many codes requested. Try again in an hour.");
  const code = await issueLoginCode(ctx.db, email, ctx.now());
  await ctx.email.sendLoginCode(email, code);
  return ctx.showCodes ? { previewCode: code } : {};
}

/** A correct code signs the person in and makes sure their wallet exists. Email is the wallet. */
export async function finishSignIn(ctx: Ctx, rawEmail: string, code: string) {
  const email = normaliseEmail(rawEmail);
  if (!(await consumeLoginCode(ctx.db, email, code.trim(), ctx.now()))) {
    throw badRequest("CODE_INVALID", "That code is wrong or has expired");
  }
  const user = await ensureUser(ctx, email, "active");
  const wallet = await ensureMainWallet(ctx, user);
  const session = await createSession(ctx.db, user.id, ctx.now());
  return { user, wallet, session };
}
