import { z } from "zod";
import { api, json, readJson } from "@/server/http";
import { emailVisitorReceipt } from "@/server/services/visitorPayments";

export const POST = api(async ({ req, ctx, params }) => {
  const { email } = await readJson(req, z.object({ email: z.string().max(254) }));
  await emailVisitorReceipt(ctx, params.token!, email);
  return json({ ok: true });
});
