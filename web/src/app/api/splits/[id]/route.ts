import { api, json, requireUser } from "@/server/http";
import { advanceSplit, getSplit } from "@/server/services/splits";
import { notFound } from "@/server/errors";
import { splitView } from "@/server/views";

/** Reading a pending split also pushes it forward, so polling the page finishes the job. */
export const GET = api(async ({ ctx, params }) => {
  const user = await requireUser(ctx);
  const split = await getSplit(ctx, params.id!);
  if (split.ownerUserId !== user.id) throw notFound("Split not found");
  return json({ split: splitView(split.status === "pending" ? await advanceSplit(ctx, split.id) : split) });
});
