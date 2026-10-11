import { cookies } from "next/headers";
import { endSession, SESSION_COOKIE } from "@/server/auth/sessions";
import { api, json, sessionToken } from "@/server/http";

export const POST = api(async ({ ctx }) => {
  const token = await sessionToken();
  if (token) await endSession(ctx.db, token);
  (await cookies()).delete(SESSION_COOKIE);
  return json({ ok: true });
});
