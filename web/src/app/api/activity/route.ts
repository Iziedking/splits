import { api, json, requireUser } from "@/server/http";
import { activityFor } from "@/server/services/activity";

/** Sent and received payments for the signed-in person, newest first. */
export const GET = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  return json(await activityFor(ctx, user));
});
