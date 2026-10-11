import { api, json, requireUser } from "@/server/http";
import { notFound } from "@/server/errors";
import { advanceWithRules } from "@/server/services/rules";
import { getTransfer, transferSteps } from "@/server/services/transfers";
import { transferView } from "@/server/views";

/** Polling a payment also drives it forward; every step is idempotent. */
export const GET = api(async ({ ctx, params }) => {
  const user = await requireUser(ctx);
  let t = await getTransfer(ctx, params.id!);
  if (t.payerUserId !== user.id) throw notFound("Payment not found");
  t = await advanceWithRules(ctx, t.id);
  return json({ transfer: transferView(ctx, t, await transferSteps(ctx, t.id)) });
});
