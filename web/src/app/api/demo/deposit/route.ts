import { z } from "zod";
import { SOURCE_CHAINS, type ChainKey } from "@/server/crosschain/chains";
import { notFound } from "@/server/errors";
import { api, json, readJson, requireUser } from "@/server/http";
import { ensureDepositWallet } from "@/server/services/depositWallets";
import { parseUsdc } from "@/server/domain/money";

const body = z.object({ chain: z.string(), amount: z.string() });

/** Preview mode only: pretend someone sent USDC to your address on another chain. */
export const POST = api(async ({ req, ctx }) => {
  if (ctx.mode !== "preview" || !ctx.preview) throw notFound();
  const user = await requireUser(ctx);
  const input = await readJson(req, body);
  const chain = SOURCE_CHAINS[input.chain as ChainKey];
  if (!chain) throw notFound("Unknown chain");
  const wallet = await ensureDepositWallet(ctx, user, chain);
  const txHash = ctx.preview.simulateDeposit(chain.key, wallet.address as `0x${string}`, parseUsdc(input.amount));
  return json({ txHash });
});
