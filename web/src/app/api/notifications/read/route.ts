import { api, json, requireUser } from "@/server/http";
import { markRead } from "@/server/services/notifications";

/** Opening the feed marks everything in it read. */
export const POST = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  await markRead(ctx, user.id);
  return json({ ok: true });
});
