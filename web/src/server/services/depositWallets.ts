import { and, eq } from "drizzle-orm";
import type { Ctx } from "../context";
import type { SourceChain } from "../crosschain/chains";
import { depositWallets } from "../db/schema";
import { badRequest } from "../errors";
import { ensureMainWallet, type User } from "./users";

export type DepositWallet = typeof depositWallets.$inferSelect;

/**
 * The person's deposit address on `chain`: their Arc wallet derived onto it, so it is the same
 * address they already know. Created the first time they open Receive; safe to call again.
 */
export async function ensureDepositWallet(ctx: Ctx, user: User, chain: SourceChain): Promise<DepositWallet> {
  if (!ctx.crossChain.chains.some((c) => c.key === chain.key)) {
    throw badRequest("CHAIN_OFF", `Deposits from ${chain.name} aren't open yet`);
  }
  const found = await depositWalletFor(ctx, user.id, chain.key);
  if (found) return found;
  const main = await ensureMainWallet(ctx, user);
  const derived = await ctx.wallets.deriveOn(main.providerWalletId, chain.circle[ctx.crossChain.network]);
  // The Receive sheet shows one address for every chain; a different one would never be watched.
  if (derived.address.toLowerCase() !== main.address.toLowerCase()) {
    console.error(`[deposits] ${chain.name} wallet for ${user.id} is ${derived.address}, not ${main.address}`);
    throw new Error(`Circle's ${chain.name} wallet is not the same address as the person's Arc wallet`);
  }
  await ctx.db
    .insert(depositWallets)
    .values({ userId: user.id, chain: chain.key, providerWalletId: derived.providerWalletId, address: derived.address })
    .onConflictDoNothing();
  return (await depositWalletFor(ctx, user.id, chain.key))!;
}

export async function depositWalletFor(ctx: Ctx, userId: string, chain: string): Promise<DepositWallet | undefined> {
  const [row] = await ctx.db
    .select()
    .from(depositWallets)
    .where(and(eq(depositWallets.userId, userId), eq(depositWallets.chain, chain)))
    .limit(1);
  return row;
}
