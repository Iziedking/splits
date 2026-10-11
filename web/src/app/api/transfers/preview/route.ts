import { api, json, readJson, requireUser } from "@/server/http";
import { previewTransfer, transferInput } from "@/server/services/transfers";

/** Exact per-recipient amounts for a payment, before anything is created. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  return json(await previewTransfer(ctx, user, await readJson(req, transferInput)));
});
