import { api, json, readJson, requireUser } from "@/server/http";
import { confirmBody, proofFrom } from "@/server/schemas";
import { confirmSplit } from "@/server/services/splits";
import { splitView } from "@/server/views";

export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const body = await readJson(req, confirmBody);
  return json({ split: splitView(await confirmSplit(ctx, user, body.actionId, proofFrom(body))) });
});
