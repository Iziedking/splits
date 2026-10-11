import { z } from "zod";
import { api, json, readJson } from "@/server/http";
import { prepareVisitorPayment } from "@/server/services/visitorPayments";
import { visitorPaymentView } from "@/server/views";
import { visitorFrom } from "@/server/visitor";

const body = z.object({
  draftId: z.uuid(),
  draftHash: z.string().regex(/^[0-9a-f]{64}$/),
  payer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  email: z.string().max(254).nullish(),
});

export const POST = api(async ({ req, ctx }) => {
  const input = await readJson(req, body);
  const p = await prepareVisitorPayment(ctx, await visitorFrom(ctx, req), {
    ...input,
    payer: input.payer as `0x${string}`,
  });
  return json({ payment: visitorPaymentView(ctx, p.transfer, null), legs: p.legs, balance: p.balance, allowance: p.allowance });
});
