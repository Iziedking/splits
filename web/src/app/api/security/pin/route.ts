import { z } from "zod";
import { setInitialPin } from "@/server/auth/pin";
import { api, json, readJson, requireUser } from "@/server/http";

export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const { pin } = await readJson(req, z.object({ pin: z.string() }));
  await setInitialPin(ctx.db, user.id, pin);
  return json({ ok: true });
});
