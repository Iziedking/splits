import { z } from "zod";
import { json, readJson } from "@/server/http";
import { NEAR } from "@/lib/near/config";
import { relayFor, userAccountId } from "@/server/near/custody";
import { emailAccountApi, requireSessionUser, siteOrigin } from "@/server/near/http";
import { notifyPaid, paidLegs } from "@/server/near/profile";

const action = z.object({
  type: z.literal("FunctionCall"),
  params: z.object({ methodName: z.string().max(64), args: z.record(z.string(), z.unknown()), gas: z.string().max(30), deposit: z.string().max(40) }),
});

/**
 * Sends a transaction for the signed-in email account; Splits pays the fee. Only app calls are allowed.
 * After a payment, everyone it paid who signed up with an email gets an email saying so.
 */
export const POST = emailAccountApi(async ({ req, ctx }) => {
  const user = await requireSessionUser(ctx);
  const tx = await readJson(req, z.object({ receiverId: z.string().max(64), actions: z.array(action).min(1).max(12) }));
  const hash = await relayFor(ctx, user.id, tx);
  const legs = paidLegs(tx, NEAR.router);
  if (hash && legs.length) await notifyPaid(ctx, user, userAccountId(user.id), legs, siteOrigin(req)).catch(() => 0);
  return json({ hash });
});
