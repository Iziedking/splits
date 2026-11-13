import { json } from "@/server/http";
import { sendTestMoney } from "@/server/near/custody";
import { emailAccountApi, requireSessionUser } from "@/server/near/http";

/** Adds 5 test USDC (no value) to the signed-in email account, once. */
export const POST = emailAccountApi(async ({ ctx }) => {
  const user = await requireSessionUser(ctx);
  return json({ hash: await sendTestMoney(ctx, user.id) });
});
