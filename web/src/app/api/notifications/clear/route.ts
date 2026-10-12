import { api, json, requireUser } from "@/server/http";
import { clearNotifications } from "@/server/services/notifications";

/** "Clear all" in the notifications feed. */
export const POST = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  await clearNotifications(ctx, user.id);
  return json({ ok: true });
});
