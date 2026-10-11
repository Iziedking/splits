import { api, json, readJson, requireUser } from "@/server/http";
import { confirmBody, proofFrom } from "@/server/schemas";
import { advanceWithRules } from "@/server/services/rules";
import { confirmTransfer, transferSteps } from "@/server/services/transfers";
import { transferView } from "@/server/views";

export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const body = await readJson(req, confirmBody);
  const confirmed = await confirmTransfer(ctx, user, body.actionId, proofFrom(body));
  const t = await advanceWithRules(ctx, confirmed.id);
  return json({ transfer: transferView(ctx, t, await transferSteps(ctx, t.id)) });
});
