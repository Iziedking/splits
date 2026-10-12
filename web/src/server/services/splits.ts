import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { splitsRouterAbi } from "../chain/abi";
import type { Ctx } from "../context";
import { actions, splits, type StoredLeg } from "../db/schema";
import { allocate, SplitRuleError, validateLegs } from "../domain/allocation";
import { parseUsdc, purposeToBytes32, MoneyError } from "../domain/money";
import { badRequest, conflict, notFound } from "../errors";
import { normaliseEmail } from "../auth/otp";
import { confirmAction, createAction, type Action, type Confirmation } from "./actions";
import { findProviderTx, refreshProviderTx, submitOnce } from "./providerTx";
import { ensureMainWallet, ensureUser, mainWallet, walletForUser, type User } from "./users";

export type Split = typeof splits.$inferSelect;

export const legInput = z.object({
  name: z.string().trim().min(1).max(40),
  to: z.discriminatedUnion("type", [
    z.object({ type: z.literal("email"), email: z.string() }),
    z.object({ type: z.literal("wallet"), walletId: z.uuid() }),
    z.object({ type: z.literal("address"), address: z.string() }),
  ]),
  amount: z.discriminatedUnion("type", [
    z.object({ type: z.literal("fixed"), usdc: z.string() }),
    z.object({ type: z.literal("percent"), percent: z.number().positive().max(100) }),
  ]),
  purpose: z.string().trim().min(1).max(31),
});

export const splitInput = z.object({
  name: z.string().trim().min(1).max(60),
  legs: z.array(legInput).min(1).max(20),
  /** Turns this split into an automatic rule for money arriving in one of your wallets. */
  autoForWalletId: z.uuid().optional(),
});

export type SplitInput = z.infer<typeof splitInput>;

function percentToBps(percent: number, index: number): number {
  const bps = Math.round(percent * 100);
  if (Math.abs(bps - percent * 100) > 1e-6) {
    throw new SplitRuleError("LEG_NEEDS_EXACTLY_ONE_RULE", "Percentages can have at most two decimals", index);
  }
  return bps;
}

/** Validates a split the way the contract will, resolving emails to (possibly new) wallets. */
export async function draftSplit(ctx: Ctx, owner: User, input: SplitInput): Promise<{ split: Split; action: Action }> {
  if (input.autoForWalletId) {
    await walletForUser(ctx, owner.id, input.autoForWalletId);
    const [existing] = await ctx.db
      .select({ id: splits.id })
      .from(splits)
      .where(eq(splits.autoForWalletId, input.autoForWalletId))
      .limit(1);
    if (existing) throw conflict("RULE_EXISTS", "That wallet already has an automatic split");
  }

  const legs: StoredLeg[] = [];
  try {
    for (const [i, leg] of input.legs.entries()) {
      const resolved = await resolveRecipient(ctx, owner, leg.to);
      legs.push({
        name: leg.name,
        email: resolved.email,
        walletId: resolved.walletId,
        address: resolved.address,
        fixedAmount: leg.amount.type === "fixed" ? parseUsdc(leg.amount.usdc).toString() : "0",
        shareBps: leg.amount.type === "percent" ? percentToBps(leg.amount.percent, i) : 0,
        purpose: leg.purpose,
      });
      purposeToBytes32(leg.purpose);
    }
    // Splits you send may share out less than 100%; automatic rules run through the contract,
    // which needs exactly 100%.
    validateLegs(toRules(legs), [ctx.router, ctx.usdc], { partialShares: !input.autoForWalletId });
  } catch (err) {
    throw asUserError(err);
  }

  const [split] = await ctx.db
    .insert(splits)
    .values({
      ownerUserId: owner.id,
      name: input.name,
      status: "pending",
      legs,
      autoForWalletId: input.autoForWalletId ?? null,
    })
    .returning();

  const action = await createAction(ctx, owner.id, "create_split", split!.id, {
    name: input.name,
    automatic: Boolean(input.autoForWalletId),
    legs: legs.map((l) => ({ name: l.name, purpose: l.purpose, fixedAmount: l.fixedAmount, shareBps: l.shareBps })),
  });
  return { split: split!, action };
}

async function resolveRecipient(
  ctx: Ctx,
  owner: User,
  to: z.infer<typeof legInput>["to"],
): Promise<{ email: string | null; walletId: string | null; address: Address }> {
  switch (to.type) {
    case "email": {
      const email = normaliseEmail(to.email);
      const user = await ensureUser(ctx, email, "invited");
      const wallet = await ensureMainWallet(ctx, user);
      return { email, walletId: wallet.id, address: getAddress(wallet.address) };
    }
    case "wallet": {
      const wallet = await walletForUser(ctx, owner.id, to.walletId);
      return { email: null, walletId: wallet.id, address: getAddress(wallet.address) };
    }
    case "address": {
      if (!isAddress(to.address)) throw badRequest("INVALID_ADDRESS", "That isn't a valid Arc address");
      return { email: null, walletId: null, address: getAddress(to.address) };
    }
  }
}

export function toRules(legs: StoredLeg[]) {
  return legs.map((l) => ({
    recipient: l.address as Address,
    fixedAmount: BigInt(l.fixedAmount),
    shareBps: l.shareBps,
  }));
}

/**
 * A split whose percentages total under 100%. The contract only stores splits that total 100%, so
 * these live in Splits alone and every payment through them is a list of exact amounts.
 */
export function sharesUnderWhole(legs: StoredLeg[]): boolean {
  const total = legs.reduce((sum, l) => sum + l.shareBps, 0);
  return total > 0 && total < 10_000;
}

export function onchainLegs(legs: StoredLeg[]) {
  return legs.map((l) => ({
    recipient: l.address as Address,
    fixedAmount: BigInt(l.fixedAmount),
    shareBps: l.shareBps,
    purpose: purposeToBytes32(l.purpose),
  }));
}

export function expectedAmounts(split: Split, amount: bigint) {
  try {
    const amounts = allocate(toRules(split.legs), amount);
    return split.legs.map((l, i) => ({ name: l.name, address: l.address, purpose: l.purpose, amount: amounts[i]! }));
  } catch (err) {
    throw asUserError(err);
  }
}

function asUserError(err: unknown): unknown {
  if (err instanceof SplitRuleError) return badRequest(err.code, err.message);
  if (err instanceof MoneyError) return badRequest("INVALID_AMOUNT", err.message);
  return err;
}

export async function confirmSplit(ctx: Ctx, owner: User, actionId: string, proof: Confirmation): Promise<Split> {
  const action = await confirmAction(ctx, owner.id, actionId, proof);
  if (action.type !== "create_split") throw badRequest("WRONG_ACTION", "That confirmation is not for a split");
  return advanceSplit(ctx, action.subjectId);
}

/**
 * Registers a confirmed split onchain from the owner's main wallet, then checks the stored
 * split matches what was asked for before marking it active.
 */
export async function advanceSplit(ctx: Ctx, splitId: string): Promise<Split> {
  const split = await getSplit(ctx, splitId);
  if (split.status !== "pending") return split;

  const [action] = await ctx.db
    .select({ id: actions.id })
    .from(actions)
    .where(and(eq(actions.subjectId, splitId), eq(actions.status, "confirmed")))
    .limit(1);
  if (!action) return split;

  // Nothing to register: payments through it are paid as exact amounts (see sharesUnderWhole).
  if (sharesUnderWhole(split.legs)) return markSplit(ctx, splitId, { status: "active", version: 1 });

  const wallet = await mainWallet(ctx, split.ownerUserId);
  if (!wallet) throw new Error(`Owner of split ${splitId} has no wallet`);

  let row = await submitOnce(ctx, splitId, "create", 1, (idempotencyKey) =>
    ctx.wallets.execute({
      walletId: wallet.providerWalletId,
      contract: ctx.router,
      callData: encodeFunctionData({ abi: splitsRouterAbi, functionName: "createSplit", args: [onchainLegs(split.legs)] }),
      idempotencyKey,
      refId: `split:${splitId}`,
    }),
  );
  row = await refreshProviderTx(ctx, row);
  if (row.status === "pending") return split;
  if (row.status === "failed") return markSplit(ctx, splitId, { status: "failed", lastError: row.error ?? "Rejected" });

  const receipt = row.txHash ? await ctx.chain.receipt(row.txHash as Hex) : null;
  if (!receipt) return split;
  const created = receipt.splitCreated.find((e) => e.owner.toLowerCase() === wallet.address.toLowerCase());
  if (receipt.status !== "success" || !created) {
    return markSplit(ctx, splitId, { status: "failed", lastError: "The split was not created onchain" });
  }

  const onchain = await ctx.chain.getSplit(created.splitId);
  const want = onchainLegs(split.legs);
  const matches =
    onchain !== null &&
    onchain.legs.length === want.length &&
    onchain.legs.every(
      (l, i) =>
        l.recipient.toLowerCase() === want[i]!.recipient.toLowerCase() &&
        l.fixedAmount === want[i]!.fixedAmount &&
        l.shareBps === want[i]!.shareBps &&
        l.purpose.toLowerCase() === want[i]!.purpose.toLowerCase(),
    );
  if (!matches) return markSplit(ctx, splitId, { status: "failed", lastError: "Onchain split does not match" });

  return markSplit(ctx, splitId, { status: "active", onchainId: created.splitId, version: onchain.version });
}

async function markSplit(ctx: Ctx, splitId: string, patch: Partial<Split>): Promise<Split> {
  const [updated] = await ctx.db
    .update(splits)
    .set({ ...patch, updatedAt: ctx.now() })
    .where(and(eq(splits.id, splitId), eq(splits.status, "pending")))
    .returning();
  return updated ?? getSplit(ctx, splitId);
}

export async function getSplit(ctx: Ctx, splitId: string): Promise<Split> {
  const [split] = await ctx.db.select().from(splits).where(eq(splits.id, splitId)).limit(1);
  if (!split) throw notFound("Split not found");
  return split;
}

/** The user's splits, leaving out drafts they never approved. */
export async function splitsFor(ctx: Ctx, userId: string): Promise<Split[]> {
  const approved = ctx.db
    .select({ id: actions.subjectId })
    .from(actions)
    .where(and(eq(actions.type, "create_split"), eq(actions.status, "confirmed")));
  return ctx.db
    .select()
    .from(splits)
    .where(and(eq(splits.ownerUserId, userId), or(ne(splits.status, "pending"), inArray(splits.id, approved))))
    .orderBy(desc(splits.createdAt));
}

export async function splitCreationTx(ctx: Ctx, splitId: string) {
  return findProviderTx(ctx, splitId, "create");
}
