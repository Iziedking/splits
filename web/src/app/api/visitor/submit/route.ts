import { after } from "next/server";
import { z } from "zod";
import { api, json, readJson } from "@/server/http";
import { advanceWithRules } from "@/server/services/rules";
import { submitVisitorPayment } from "@/server/services/visitorPayments";
import { visitorPaymentView } from "@/server/views";

const body = z.object({ token: z.string().max(64), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

export const POST = api(async ({ req, ctx }) => {
  const input = await readJson(req, body);
  const t = await submitVisitorPayment(ctx, input.token, input.txHash as `0x${string}`);
  after(() => advanceWithRules(ctx, t.id).catch((err) => console.error(`[visitor] advancing ${t.id}`, err)));
  return json({ payment: visitorPaymentView(ctx, t, null) });
});
