import { z } from "zod";
import { api, json, readJson, requireUser } from "@/server/http";
import { startTagChange } from "@/server/services/tags";
import { actionView } from "@/server/views";

/** Starts a tag change; it waits for the PIN or Face ID. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const { tag } = await readJson(req, z.object({ tag: z.string().max(40) }));
  const started = await startTagChange(ctx, user, tag);
  return json({ action: actionView(started.action), tag: started.tag }, 201);
});
