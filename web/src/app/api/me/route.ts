import { api, hasPasskey, json, requireUser } from "@/server/http";
import { balancesFor, walletsFor } from "@/server/services/users";
import { userView, walletView } from "@/server/views";

export const GET = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  const wallets = await balancesFor(ctx, await walletsFor(ctx, user.id));
  return json({
    mode: ctx.mode,
    network: ctx.network,
    agent: ctx.agent !== null,
    user: userView(user, await hasPasskey(ctx, user.id)),
    wallets: wallets.map((w) => walletView(ctx, w)),
  });
});
