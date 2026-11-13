import { z } from "zod";
import { json, readJson } from "@/server/http";
import { relayFor } from "@/server/near/custody";
import { emailAccountApi, requireSessionUser } from "@/server/near/http";

const action = z.object({
  type: z.literal("FunctionCall"),
  params: z.object({ methodName: z.string().max(64), args: z.record(z.string(), z.unknown()), gas: z.string().max(30), deposit: z.string().max(40) }),
});

/** Sends a transaction for the signed-in email account; Splits pays the fee. Only app calls are allowed. */
export const POST = emailAccountApi(async ({ req, ctx }) => {
  const user = await requireSessionUser(ctx);
  const tx = await readJson(req, z.object({ receiverId: z.string().max(64), actions: z.array(action).min(1).max(12) }));
  return json({ hash: await relayFor(ctx, user.id, tx) });
});
