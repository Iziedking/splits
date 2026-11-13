import { z } from "zod";
import { isAccountId } from "@/lib/near/payment";
import { json, readJson } from "@/server/http";
import { emailAccountApi, siteOrigin } from "@/server/near/http";
import { notifyWalletPayment } from "@/server/near/profile";

/**
 * After a NEAR wallet pays, the page asks for the "you received money" emails. The server reads the
 * transaction from the chain itself, so only a real, successful payment by that wallet sends any.
 */
export const POST = emailAccountApi(async ({ req, ctx }) => {
  const { hash, payer } = await readJson(req, z.object({ hash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/), payer: z.string().refine(isAccountId) }));
  return json({ sent: await notifyWalletPayment(ctx, hash, payer, siteOrigin(req)) });
});
