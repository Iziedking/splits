import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { finishPasskeyRegistration } from "@/server/auth/passkeys";
import { api, json, readJson, requireUser } from "@/server/http";

export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const { response } = await readJson(req, z.object({ response: z.looseObject({ id: z.string() }) }));
  await finishPasskeyRegistration(ctx.db, ctx.rp, user.id, response as unknown as RegistrationResponseJSON, ctx.now());
  return json({ ok: true });
});
