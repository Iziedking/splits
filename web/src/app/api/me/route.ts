import { api, hasPasskey, json, requireUser } from "@/server/http";
import { balancesFor, walletsFor } from "@/server/services/users";
import { meView } from "@/server/views";

export const GET = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  const wallets = await balancesFor(ctx, await walletsFor(ctx, user.id));
  return json(meView(ctx, user, await hasPasskey(ctx, user.id), wallets));
});
