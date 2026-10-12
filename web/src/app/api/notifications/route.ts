import { api, json, requireUser } from "@/server/http";
import { listNotifications } from "@/server/services/notifications";

/** The signed-in person's notifications, newest first, with the unread count. */
export const GET = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  return json(await listNotifications(ctx, user.id));
});
