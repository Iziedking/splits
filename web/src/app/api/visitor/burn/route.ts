import { after } from "next/server";
import { z } from "zod";
import { api, json, readJson } from "@/server/http";
import { crossPaymentFor, submitCrossBurn } from "@/server/services/crossPay";
import { advanceWithRules } from "@/server/services/rules";
import { visitorPaymentView } from "@/server/views";

const body = z.object({ token: z.string().max(64), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/** The visitor's page reports the burn it sent on the source chain. The server checks it there. */
export const POST = api(async ({ req, ctx }) => {
  const input = await readJson(req, body);
  const t = await submitCrossBurn(ctx, input.token, input.txHash as `0x${string}`);
  after(() => advanceWithRules(ctx, t.id).catch((err) => console.error(`[visitor] advancing ${t.id}`, err)));
  return json({ payment: visitorPaymentView(ctx, t, null, (await crossPaymentFor(ctx, t.id)) ?? null) });
});
