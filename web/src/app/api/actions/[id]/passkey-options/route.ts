import { api, json, requireUser } from "@/server/http";
import { passkeyOptionsForAction } from "@/server/services/actions";

export const POST = api(async ({ ctx, params }) => {
  const user = await requireUser(ctx);
  return json(await passkeyOptionsForAction(ctx, user.id, params.id!));
});
