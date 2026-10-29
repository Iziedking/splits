import { api, json, readJson, requireUser } from "@/server/http";
import { chatInput, sendMessage } from "@/server/support/chat";

/** One turn of a support chat: `text` from the person, or `person: true` to hand it to the team. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  return json(await sendMessage(ctx, user, await readJson(req, chatInput)));
});
