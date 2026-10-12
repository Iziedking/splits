import { api, json, requireUser } from "@/server/http";
import { depositView } from "@/server/services/depositView";
import { ensureDepositWallet } from "@/server/services/depositWallets";

/** The Receive sheet: the one address, the chains it works on, and the latest deposit. */
export const GET = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  return json(await depositView(ctx, user));
});

/** Opening the EVM tab sets up the address on every enabled chain (once). */
export const POST = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  for (const chain of ctx.crossChain.chains) await ensureDepositWallet(ctx, user, chain);
  return json(await depositView(ctx, user));
});
