import { cookies } from "next/headers";
import { endSession, SESSION_COOKIE } from "@/server/auth/sessions";
import { json } from "@/server/http";
import { emailAccountApi } from "@/server/near/http";

export const POST = emailAccountApi(async ({ ctx }) => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await endSession(ctx.db, token);
  (await cookies()).delete(SESSION_COOKIE);
  return json({ ok: true });
});
