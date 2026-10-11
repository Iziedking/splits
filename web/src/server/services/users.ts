import { and, eq } from "drizzle-orm";
import type { Address } from "viem";
import type { Ctx } from "../context";
import { users, wallets } from "../db/schema";
import { deterministicUuid } from "../domain/ids";
import { badRequest, notFound } from "../errors";

export type User = typeof users.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;

/** Finds or creates the person behind an email. Signing in turns an invited user active. */
export async function ensureUser(ctx: Ctx, email: string, status: "invited" | "active"): Promise<User> {
  await ctx.db.insert(users).values({ email, status }).onConflictDoNothing({ target: users.email });
  const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`User ${email} vanished after insert`);
  if (status === "active" && user.status === "invited") {
    const [active] = await ctx.db.update(users).set({ status: "active" }).where(eq(users.id, user.id)).returning();
    return active!;
  }
  return user;
}

/**
 * Every user has one main wallet, created the first time anyone needs it: when they sign in, or
 * when someone names their email as a recipient. The idempotency key makes a retry return the
 * same Circle wallet.
 */
export async function ensureMainWallet(ctx: Ctx, user: User): Promise<Wallet> {
  const existing = await mainWallet(ctx, user.id);
  if (existing) return existing;

  const created = await ctx.wallets.createWallet({
    refId: user.id,
    name: "main",
    idempotencyKey: deterministicUuid(`wallet:main:${user.id}`),
  });
  await ctx.db
    .insert(wallets)
    .values({
      userId: user.id,
      kind: "main",
      label: "Main",
      providerWalletId: created.providerWalletId,
      address: created.address,
    })
    .onConflictDoNothing();
  const wallet = await mainWallet(ctx, user.id);
  if (!wallet) throw new Error(`Main wallet for ${user.id} missing after create`);
  return wallet;
}

export async function mainWallet(ctx: Ctx, userId: string): Promise<Wallet | undefined> {
  const [wallet] = await ctx.db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.kind, "main")))
    .limit(1);
  return wallet;
}

/** A named pocket, e.g. "Savings", that a receiver's own split can route money into. */
export async function createPocket(ctx: Ctx, user: User, label: string): Promise<Wallet> {
  const name = label.trim();
  if (!name || name.length > 40) throw badRequest("POCKET_NAME", "Give the pocket a name up to 40 characters");
  const count = (await ctx.db.select().from(wallets).where(eq(wallets.userId, user.id))).length;
  if (count >= 6) throw badRequest("POCKET_LIMIT", "You can have up to 5 pockets");
  const created = await ctx.wallets.createWallet({
    refId: `${user.id}:pocket:${count}`,
    name,
    idempotencyKey: deterministicUuid(`wallet:pocket:${user.id}:${count}`),
  });
  const [wallet] = await ctx.db
    .insert(wallets)
    .values({
      userId: user.id,
      kind: "pocket",
      label: name,
      providerWalletId: created.providerWalletId,
      address: created.address,
    })
    .returning();
  return wallet!;
}

export async function walletsFor(ctx: Ctx, userId: string): Promise<Wallet[]> {
  return ctx.db.select().from(wallets).where(eq(wallets.userId, userId));
}

export async function walletForUser(ctx: Ctx, userId: string, walletId: string): Promise<Wallet> {
  const [wallet] = await ctx.db
    .select()
    .from(wallets)
    .where(and(eq(wallets.id, walletId), eq(wallets.userId, userId)))
    .limit(1);
  if (!wallet) throw notFound("Wallet not found");
  return wallet;
}

export async function walletByAddress(ctx: Ctx, address: Address): Promise<Wallet | undefined> {
  const [wallet] = await ctx.db.select().from(wallets).where(eq(wallets.address, address)).limit(1);
  return wallet;
}

export async function balancesFor(ctx: Ctx, list: Wallet[]) {
  return Promise.all(
    list.map(async (w) => ({ ...w, balance: await ctx.chain.usdcBalance(w.address as Address) })),
  );
}
