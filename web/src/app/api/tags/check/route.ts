import { api, json, requireUser } from "@/server/http";
import { tooMany } from "@/server/errors";
import { hitRateLimit } from "@/server/services/rateLimits";
import { checkTag } from "@/server/services/tags";

/** Whether a tag is free, as someone types it. */
export const GET = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  if (!(await hitRateLimit(ctx, `tags:check:u:${user.id}`, 120, 3_600_000))) throw tooMany("TOO_MANY_CHECKS", "Slow down a little, then try again.");
  const raw = new URL(req.url).searchParams.get("tag") ?? "";
  return json(await checkTag(ctx, raw.slice(0, 40)));
});
