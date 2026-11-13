import { z } from "zod";
import { isAccountId } from "@/lib/near/payment";
import { json, readJson } from "@/server/http";
import { emailAccountApi, sessionUser } from "@/server/near/http";
import { accountForEmail } from "@/server/near/profile";

const body = z.object({ email: z.string().email().max(254), payer: z.string().refine(isAccountId).optional() });

/**
 * The Splits account behind an email, made now if the person is new, so anyone can be paid by email.
 * A signed-in person's new contacts are capped per person; a NEAR wallet's, per network address.
 */
export const POST = emailAccountApi(async ({ req, ctx }) => {
  const { email, payer } = await readJson(req, body);
  const user = await sessionUser(ctx);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const who = user ? { userId: user.id, email: user.email } : { wallet: payer ?? "", ip };
  return json({ accountId: await accountForEmail(ctx, who, email) });
});
