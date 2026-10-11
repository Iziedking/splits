import { z } from "zod";
import { changePin } from "@/server/auth/pin";
import { api, json, readJson, requireUser } from "@/server/http";

const body = z.object({ currentPin: z.string(), newPin: z.string() });

/** Changes the PIN. Needs the current one, which counts toward the wrong-PIN lockout. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const { currentPin, newPin } = await readJson(req, body);
  await changePin(ctx.db, user.id, currentPin, newPin, ctx.now());
  return json({ ok: true });
});
