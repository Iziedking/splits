import { api, hasPasskey, json, readJson, requireUser } from "@/server/http";
import { confirmBody, proofFrom } from "@/server/schemas";
import { confirmTagChange } from "@/server/services/tags";
import { userView } from "@/server/views";

/** Confirms a tag change with the PIN or a passkey. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const body = await readJson(req, confirmBody);
  const updated = await confirmTagChange(ctx, user, body.actionId, proofFrom(body));
  return json({ user: userView(updated, await hasPasskey(ctx, updated.id)) });
});
