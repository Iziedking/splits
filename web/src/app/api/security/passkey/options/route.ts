import { z } from "zod";
import { startPasskeyRegistration } from "@/server/auth/passkeys";
import { api, json, readJson, requireUser } from "@/server/http";

/** Starts adding a passkey. Needs the PIN, which counts toward the wrong-PIN lockout. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const { pin } = await readJson(req, z.object({ pin: z.string() }));
  return json(await startPasskeyRegistration(ctx.db, ctx.rp, user, pin, ctx.now()));
});
