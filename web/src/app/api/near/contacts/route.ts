import { json } from "@/server/http";
import { emailAccountApi, requireSessionUser } from "@/server/near/http";
import { contactsOf } from "@/server/near/profile";

/** The people the signed-in person paid by email, so their names show on any device. */
export const GET = emailAccountApi(async ({ ctx }) => {
  const user = await requireSessionUser(ctx);
  return json({ contacts: await contactsOf(ctx, user.id) });
});
