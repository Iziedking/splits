import { and, eq, isNull } from "drizzle-orm";
import type { Ctx } from "../context";
import type { SourceChain } from "../crosschain/chains";
import { depositWallets, users, wallets } from "../db/schema";
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

const RETRY_AFTER_MS = 10 * 60_000;
const retryAt = new Map<string, number>();

/**
 * Opens the deposit address on every enabled chain for people who have none there yet, a few per
 * sweep. Their address is shown on Home and Profile, so money can arrive on another chain before
 * they ever open Receive; it is only watched (webhooks, polling) once the wallet exists here.
 */
export async function openMissingDepositWallets(ctx: Ctx, limit = 10): Promise<number> {
  let opened = 0;
  const now = ctx.now().getTime();
  for (const chain of ctx.crossChain.chains) {
    if (opened >= limit) break;
    const missing = await ctx.db
      .select({ user: users })
      .from(wallets)
      .innerJoin(users, eq(users.id, wallets.userId))
      .leftJoin(depositWallets, and(eq(depositWallets.userId, wallets.userId), eq(depositWallets.chain, chain.key)))
      .where(and(eq(wallets.kind, "main"), isNull(depositWallets.id)))
      .limit(100);
    // Someone whose address keeps failing waits before the next try, so they never hold the slots.
    for (const { user } of missing.filter((m) => (retryAt.get(`${m.user.id}:${chain.key}`) ?? 0) <= now).slice(0, limit - opened)) {
      try {
        await ensureDepositWallet(ctx, user, chain);
        opened++;
      } catch (err) {
        retryAt.set(`${user.id}:${chain.key}`, now + RETRY_AFTER_MS);
        console.error(`[deposits] opening ${chain.name} for ${user.id} failed`, err);
      }
    }
  }
  return opened;
}
