import { api, json } from "@/server/http";
import { receiptLinks } from "@/server/services/receipts";
import { crossPaymentFor } from "@/server/services/crossPay";
import { advanceWithRules } from "@/server/services/rules";
import { visitorPaymentByToken } from "@/server/services/visitorPayments";
import { visitorPaymentView } from "@/server/views";

/** The token is the permission, like a receipt link. Polling also drives the payment forward. */
export const GET = api(async ({ ctx, params }) => {
  let t = await visitorPaymentByToken(ctx, params.token!);
  t = await advanceWithRules(ctx, t.id, 1_500);
  return json({ payment: visitorPaymentView(ctx, t, await receiptLinks(ctx, t), (await crossPaymentFor(ctx, t.id)) ?? null) });
});
