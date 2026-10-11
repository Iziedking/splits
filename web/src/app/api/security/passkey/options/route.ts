import { startPasskeyRegistration } from "@/server/auth/passkeys";
import { api, json, requireUser } from "@/server/http";

export const POST = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  return json(await startPasskeyRegistration(ctx.db, ctx.rp, user, ctx.now()));
});
