import { cookies } from "next/headers";
import { z } from "zod";
import { consumeLoginCode, normaliseEmail } from "@/server/auth/otp";
import { createSession, SESSION_COOKIE } from "@/server/auth/sessions";
import { badRequest } from "@/server/errors";
import { json, readJson } from "@/server/http";
import { ensureNearAccount } from "@/server/near/custody";
import { emailAccountApi, isHttps } from "@/server/near/http";
import { recordNearAccount } from "@/server/near/profile";
import { ensureUser } from "@/server/services/users";

/** A correct code signs the person in and makes sure their NEAR account exists. No Arc wallet is made. */
export const POST = emailAccountApi(async ({ req, ctx }) => {
  const body = await readJson(req, z.object({ email: z.string().email(), code: z.string() }));
  const email = normaliseEmail(body.email);
  if (!(await consumeLoginCode(ctx.db, email, body.code.trim(), ctx.now()))) throw badRequest("CODE_INVALID", "That code is wrong or has expired");
  const user = await ensureUser(ctx, email, "active");
  const accountId = await ensureNearAccount(ctx, user.id);
  await recordNearAccount(ctx, user.id, accountId);
  const session = await createSession(ctx.db, user.id, ctx.now());
  (await cookies()).set(SESSION_COOKIE, session.token, { httpOnly: true, secure: isHttps(req), sameSite: "lax", path: "/", expires: session.expiresAt });
  return json({ accountId, email });
});
