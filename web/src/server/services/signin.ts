import { consumeLoginCode, issueLoginCode, normaliseEmail } from "../auth/otp";
import { createSession } from "../auth/sessions";
import type { Ctx } from "../context";
import { badRequest } from "../errors";
import { ensureMainWallet, ensureUser } from "./users";

/** Sends a 6-digit code. In preview, or on testnet with EMAIL_PROVIDER=screen, the code is returned for the screen. */
export async function startSignIn(ctx: Ctx, rawEmail: string): Promise<{ previewCode?: string }> {
  const email = normaliseEmail(rawEmail);
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
