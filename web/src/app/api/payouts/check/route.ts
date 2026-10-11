import { api, json, readJson, requireUser } from "@/server/http";
import { checkPayout, payoutCheckInput } from "@/server/services/payouts";

/** Checks a payout list line by line and, when every line is ready, saves it as a draft. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  return json(await checkPayout(ctx, user, await readJson(req, payoutCheckInput)));
});
