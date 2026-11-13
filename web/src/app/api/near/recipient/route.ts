import { z } from "zod";
import { json, readJson } from "@/server/http";
import { emailAccountApi, requireSessionUser } from "@/server/near/http";
import { accountForEmail } from "@/server/near/profile";

/** The Splits account behind an email, made now if the person is new, so they can be paid by email. */
export const POST = emailAccountApi(async ({ req, ctx }) => {
  const user = await requireSessionUser(ctx);
  const { email } = await readJson(req, z.object({ email: z.string().email().max(254) }));
  return json({ accountId: await accountForEmail(ctx, user, email) });
});
