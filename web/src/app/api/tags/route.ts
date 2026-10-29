import { z } from "zod";
import { api, hasPasskey, json, readJson, requireUser } from "@/server/http";
import { claimTag } from "@/server/services/tags";
import { userView } from "@/server/views";

/** Takes the signed-in account's first Split tag. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const { tag } = await readJson(req, z.object({ tag: z.string().max(40) }));
  const updated = await claimTag(ctx, user, tag);
  return json({ user: userView(updated, await hasPasskey(ctx, updated.id)) });
});
