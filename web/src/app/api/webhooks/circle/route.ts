import { json, webhookApi } from "@/server/http";
import { handleCircleWebhook } from "@/server/services/webhooks";

export const POST = webhookApi(async ({ req, ctx }) => {
  if (ctx.mode !== "live") return json({ ignored: true });
  const outcome = await handleCircleWebhook(ctx, await req.text(), {
    signature: req.headers.get("x-circle-signature"),
    keyId: req.headers.get("x-circle-key-id"),
  });
  return json({ outcome });
});
