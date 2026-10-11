import { api, json, readJson } from "@/server/http";
import { payoutCheckInput } from "@/server/services/payouts";
import { checkVisitorList } from "@/server/services/visitorPayments";
import { visitorFrom } from "@/server/visitor";

export const POST = api(async ({ req, ctx }) =>
  json(await checkVisitorList(ctx, await visitorFrom(ctx, req), await readJson(req, payoutCheckInput))),
);
