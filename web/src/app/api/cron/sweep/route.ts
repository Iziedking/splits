import { timingSafeEqual } from "node:crypto";
import { getConfig } from "@/server/config";
import { unauthorized } from "@/server/errors";
import { json, webhookApi } from "@/server/http";
import { sweep } from "@/server/services/sweeper";

function authorised(header: string | null): boolean {
  const secret = getConfig().CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** For schedulers: drives stalled payments forward. Needs CRON_SECRET as a bearer token. */
export const GET = webhookApi(async ({ req, ctx }) => {
  if (!authorised(req.headers.get("authorization"))) throw unauthorized("Bad cron secret");
  return json(await sweep(ctx));
});
