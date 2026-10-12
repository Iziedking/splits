import type { Ctx } from "../context";
import { depositWallets } from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { latestDepositFor } from "./deposits";
import { mainWallet, type User } from "./users";

const usd = (units: bigint) => `${units / 1_000_000n}.${((units % 1_000_000n) / 10_000n).toString().padStart(2, "0")}`;

/** What the Receive sheet shows: the one address, where it works, and the latest deposit. */
export async function depositView(ctx: Ctx, user: User) {
  const keys = ctx.crossChain.chains.map((c) => c.key);
  const opened = keys.length
    ? await ctx.db
        .select({ chain: depositWallets.chain })
        .from(depositWallets)
        .where(and(eq(depositWallets.userId, user.id), inArray(depositWallets.chain, keys)))
    : [];
  return {
    address: (await mainWallet(ctx, user.id))?.address ?? null,
    chains: ctx.crossChain.chains.map((c) => ({ key: c.key, name: c.name, min: usd(c.minUnits), fast: c.fast })),
    /** Every enabled chain has its deposit wallet: money sent there will be found and moved. */
    ready: opened.length === keys.length,
    latest: await latestDepositFor(ctx, user.id),
    demoCard: ctx.limits.fundingEnabled,
    preview: ctx.mode === "preview",
  };
}
