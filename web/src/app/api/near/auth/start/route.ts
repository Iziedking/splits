import { z } from "zod";
import { emailAccountApi } from "@/server/near/http";
import { json, readJson } from "@/server/http";
import { startSignIn } from "@/server/services/signin";
import { clientIp } from "@/server/visitor";

/** Sends a 6-digit sign-in code to the email, the same codes Splits uses everywhere. */
export const POST = emailAccountApi(async ({ req, ctx }) => {
  const { email } = await readJson(req, z.object({ email: z.string().email() }));
  return json(await startSignIn(ctx, email, clientIp(req.headers, ctx.trustProxy)));
});
