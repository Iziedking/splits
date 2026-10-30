import { api, json, requireUser } from "@/server/http";
import { tooMany } from "@/server/errors";
import { hitRateLimit } from "@/server/services/rateLimits";
import { checkTag } from "@/server/services/tags";

const HOUR = 3_600_000;

/** Whether a tag is free, as someone types it. */
export const GET = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  // Per person, and in total, so many accounts together can't walk through every tag.
  if (!(await hitRateLimit(ctx, `tags:check:u:${user.id}`, 120, HOUR)) || !(await hitRateLimit(ctx, "tags:check:all", 20_000, HOUR))) {
    throw tooMany("TOO_MANY_CHECKS", "Slow down a little, then try again.");
  }
  const raw = new URL(req.url).searchParams.get("tag") ?? "";
  return json(await checkTag(ctx, raw.slice(0, 40)));
});
