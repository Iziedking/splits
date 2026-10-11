import { api, json, requireUser } from "@/server/http";
import { notFound } from "@/server/errors";
import { advanceWithRules } from "@/server/services/rules";
import { getTransfer, refreshPendingSteps, transferSteps } from "@/server/services/transfers";
import { transferView } from "@/server/views";

/**
 * Polling a payment also drives it forward; every step is idempotent. The work is time-boxed so the
 * live screen gets an answer quickly and can show each step; the sweeper and the next poll continue.
 */
const POLL_BUDGET_MS = 1_500;

export const GET = api(async ({ ctx, params }) => {
  const user = await requireUser(ctx);
  let t = await getTransfer(ctx, params.id!);
  if (t.payerUserId !== user.id) throw notFound("Payment not found");
  t = await advanceWithRules(ctx, t.id, POLL_BUDGET_MS);
  await refreshPendingSteps(ctx, t.id);
  return json({ transfer: transferView(ctx, t, await transferSteps(ctx, t.id)) });
});
