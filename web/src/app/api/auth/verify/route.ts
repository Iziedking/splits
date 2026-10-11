import { cookies } from "next/headers";
import { z } from "zod";
import { SESSION_COOKIE } from "@/server/auth/sessions";
import { api, hasPasskey, json, readJson } from "@/server/http";
import { finishSignIn } from "@/server/services/signin";
import { userView, walletView } from "@/server/views";

export const POST = api(async ({ req, ctx }) => {
  const { email, code } = await readJson(req, z.object({ email: z.string(), code: z.string() }));
  const { user, wallet, session } = await finishSignIn(ctx, email, code);
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: ctx.rp.origin.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return json({ user: userView(user, await hasPasskey(ctx, user.id)), wallet: walletView(ctx, wallet) });
});
