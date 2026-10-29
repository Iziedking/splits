import { api, json, requireUser } from "@/server/http";
import { searchTags } from "@/server/services/tags";

/** Tags starting with what a signed-in payer typed. */
export const GET = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return json({ tags: await searchTags(ctx, user, q.slice(0, 40)) });
});
