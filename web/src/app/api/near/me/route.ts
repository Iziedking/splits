import { json } from "@/server/http";
import { appAccountId, hadTestMoney, userAccountId } from "@/server/near/custody";
import { emailAccountApi, sessionUser } from "@/server/near/http";
import { getAvatar } from "@/server/near/profile";

/** Who is signed in with email here, if anyone. The relayer's account is how a browser finds relayed transactions. */
export const GET = emailAccountApi(async ({ ctx }) => {
  const user = await sessionUser(ctx);
  if (!user) return json({ accountId: null, relayer: appAccountId() });
  return json({ accountId: userAccountId(user.id), email: user.email, testMoneyTaken: await hadTestMoney(ctx, user.id), avatar: await getAvatar(ctx, user.id), relayer: appAccountId() });
});
