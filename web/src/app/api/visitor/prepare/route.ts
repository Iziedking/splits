import { z } from "zod";
import { api, json, readJson } from "@/server/http";
import { prepareCrossPayment } from "@/server/services/crossPay";
import { prepareVisitorPayment } from "@/server/services/visitorPayments";
import { visitorPaymentView } from "@/server/views";
import { visitorFrom } from "@/server/visitor";

const body = z.object({
  draftId: z.uuid(),
  draftHash: z.string().regex(/^[0-9a-f]{64}$/),
  payer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  email: z.string().max(254).nullish(),
  /** Pay from this chain instead of Arc (cross-chain pay). */
  sourceChain: z.string().max(16).optional(),
});

export const POST = api(async ({ req, ctx }) => {
  const input = await readJson(req, body);
  if (input.sourceChain) {
    const c = await prepareCrossPayment(ctx, await visitorFrom(ctx, req), {
      draftId: input.draftId,
      draftHash: input.draftHash,
      payer: input.payer as `0x${string}`,
      email: input.email,
      chain: input.sourceChain,
    });
    return json({ payment: visitorPaymentView(ctx, c.transfer, null, c.cross), cost: c.cost, call: c.call });
  }
  const p = await prepareVisitorPayment(ctx, await visitorFrom(ctx, req), {
    ...input,
    payer: input.payer as `0x${string}`,
  });
  return json({ payment: visitorPaymentView(ctx, p.transfer, null), legs: p.legs, balance: p.balance, allowance: p.allowance });
});
