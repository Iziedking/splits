import { and, desc, eq, inArray, isNull, lt, ne, notExists, notInArray, or } from "drizzle-orm";
import type { Address } from "viem";
import type { Ctx } from "../context";
import { earnMoves, transfers, wallets } from "../db/schema";
import { CENT } from "../domain/allocation";
import { formatUsdc, MoneyError, parseUsdc } from "../domain/money";
import type { EarnProvider } from "../earn/types";
import { badRequest, conflict, notFound } from "../errors";
import { confirmAction, createAction, type Action, type Confirmation } from "./actions";
import { notify } from "./notifications";
import { findProviderTx, refreshProviderTx, submitOnce } from "./providerTx";
import { createPocket, mainWallet, type User, type Wallet } from "./users";

/**
 * The Earning pocket: a pocket wallet whose idle USDC is kept in one vetted vault through Arc Earn
 * Kit. Money comes in by hand (PIN or passkey) or by an automatic split paying the pocket's address;
 * the sweeper puts idle money into the vault; money goes out to the spendable balance by hand.
 *
 * Wallet-to-wallet legs go through submitOnce, so a retry finds the original transfer. Vault calls
 * read balances first (deposit what is idle; withdraw only what the pocket doesn't already hold),
 * under a per-pocket lease, so a retry after a crash never deposits or withdraws twice.
 */

export type EarnMove = typeof earnMoves.$inferSelect;
export type EarnStatus =
  | { available: false }
  | {
      available: true;
      vault: { name: string; apy: number; address: string };
      pocket: { id: string; address: string; idle: string; invested: string; total: string; earned: string | null } | null;
    };

const LEASE_MS = 60_000;
/** How long a sent withdrawal that hasn't shown up is given to land before it is sent again. */
const WITHDRAW_PENDING_MS = 10 * 60_000;
const ACTIVE = ["confirmed", "withdrawing", "returning"] as const;
const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

function requireEarn(ctx: Ctx): EarnProvider {
  if (!ctx.earn) throw conflict("EARN_OFF", "The Earning pocket isn't available yet");
  return ctx.earn;
}

export async function earningPocket(ctx: Ctx, userId: string): Promise<Wallet | null> {
  const [pocket] = await ctx.db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.earn, true)))
    .limit(1);
  return pocket ?? null;
}

/** Creates the person's Earning pocket, or returns the one they have. */
export async function openEarningPocket(ctx: Ctx, user: User): Promise<Wallet> {
  requireEarn(ctx);
  const existing = await earningPocket(ctx, user.id);
  if (existing) return existing;
  const pocket = await createPocket(ctx, user, "Earning");
  const [flagged] = await ctx.db.update(wallets).set({ earn: true }).where(eq(wallets.id, pocket.id)).returning();
  return flagged!;
}

/** The vault, its rate, and what the pocket holds: in the vault, waiting to go in, and earned. */
export async function earnStatus(ctx: Ctx, userId: string): Promise<EarnStatus> {
  if (!ctx.earn) return { available: false };
  const vault = await ctx.earn.vault();
  const pocket = await earningPocket(ctx, userId);
  const vaultView = { name: vault.name, apy: vault.apy, address: vault.address };
  if (!pocket) return { available: true, vault: vaultView, pocket: null };
  const owner = pocket.address as Address;
  const [idle, position] = await Promise.all([ctx.chain.usdcBalance(owner), ctx.earn.position(owner)]);
  return {
    available: true,
    vault: vaultView,
    pocket: {
      id: pocket.id,
      address: pocket.address,
      idle: formatUsdc(idle),
      invested: formatUsdc(position.assets),
      total: formatUsdc(idle + position.assets),
      earned: position.principal === null ? null : formatUsdc(max(0n, position.assets - position.principal)),
    },
  };
}

/** A move in or out, waiting for the person's PIN or passkey. No Splits fee, no send limit: it's their own money. */
export async function startMove(ctx: Ctx, user: User, kind: "in" | "out", amountText: string): Promise<{ move: EarnMove; action: Action }> {
  const earn = requireEarn(ctx);
  const pocket = await earningPocket(ctx, user.id);
  if (!pocket) throw badRequest("NO_POCKET", "Turn on your Earning pocket first");
  let amount: bigint;
  try {
    amount = parseUsdc(amountText);
  } catch (err) {
    if (err instanceof MoneyError) throw badRequest("AMOUNT", "Enter an amount like 25 or 2.50");
    throw err;
  }
  if (amount < CENT) throw badRequest("AMOUNT", "Move at least $0.01");
  if (kind === "in") {
    const main = await mainWallet(ctx, user.id);
    const available = main ? await ctx.chain.usdcBalance(main.address as Address) : 0n;
    if (amount > available) throw badRequest("BALANCE", `You have $${formatUsdc(available)} to move`);
  } else {
    const owner = pocket.address as Address;
    const [idle, position] = await Promise.all([ctx.chain.usdcBalance(owner), earn.position(owner)]);
    if (amount > idle + position.assets) throw badRequest("BALANCE", `About $${formatUsdc(idle + position.assets)} is in your Earning pocket`);
  }
  const [busy] = await ctx.db
    .select({ id: earnMoves.id })
    .from(earnMoves)
    .where(and(eq(earnMoves.pocketWalletId, pocket.id), inArray(earnMoves.status, [...ACTIVE])))
    .limit(1);
  if (busy) throw conflict("MOVE_BUSY", "Another move is still under way. Try again in a moment.");
  const [move] = await ctx.db
    .insert(earnMoves)
    .values({
      userId: user.id,
      pocketWalletId: pocket.id,
      kind,
      amount: amount.toString(),
      status: "awaiting_confirmation",
      createdAt: ctx.now(),
      updatedAt: ctx.now(),
    })
    .returning();
  const action = await createAction(ctx, user.id, "earn_move", move!.id, { kind, amount: formatUsdc(amount) });
  return { move: move!, action };
}

export async function confirmMove(ctx: Ctx, user: User, actionId: string, proof: Confirmation): Promise<EarnMove> {
  const action = await confirmAction(ctx, user.id, actionId, proof, "earn_move", "That confirmation is not for the Earning pocket");
  const pending = await getMove(ctx, action.subjectId);
  // Two moves drafted side by side may not both run: the second could spend the first's money.
  const other = ctx.db
    .select({ id: earnMoves.id })
    .from(earnMoves)
    .where(and(eq(earnMoves.pocketWalletId, pending.pocketWalletId), ne(earnMoves.id, pending.id), inArray(earnMoves.status, [...ACTIVE])));
  const [move] = await ctx.db
    .update(earnMoves)
    .set({ status: "confirmed", updatedAt: ctx.now() })
    .where(and(eq(earnMoves.id, pending.id), eq(earnMoves.status, "awaiting_confirmation"), notExists(other)))
    .returning();
  if (!move) {
    if ((await getMove(ctx, pending.id)).status !== "awaiting_confirmation") throw conflict("ALREADY_CONFIRMED", "This move is already under way");
    throw conflict("MOVE_BUSY", "Another move is still under way. Try again in a moment.");
  }
  return move;
}

/** A payment from this wallet is between its approval and its send: moving money out now would sink it. */
async function paymentUnderWay(ctx: Ctx, wallet: Wallet): Promise<boolean> {
  if (!wallet.busyTransferId) return false;
  const [busy] = await ctx.db
    .select({ id: transfers.id })
    .from(transfers)
    .where(and(eq(transfers.id, wallet.busyTransferId), notInArray(transfers.status, ["settled", "failed", "cancelled"])))
    .limit(1);
  return Boolean(busy);
}

export async function getMove(ctx: Ctx, id: string): Promise<EarnMove> {
  const [move] = await ctx.db.select().from(earnMoves).where(eq(earnMoves.id, id)).limit(1);
  if (!move) throw notFound("Move not found");
  return move;
}

export async function listMoves(ctx: Ctx, userId: string, limit = 20): Promise<EarnMove[]> {
  return ctx.db
    .select()
    .from(earnMoves)
    .where(and(eq(earnMoves.userId, userId), inArray(earnMoves.status, ["confirmed", "withdrawing", "returning", "done", "failed"])))
    .orderBy(desc(earnMoves.createdAt))
    .limit(limit);
}

/** One worker at a time per pocket: deposits, withdrawals and returns never interleave. */
async function lease(ctx: Ctx, pocketId: string): Promise<boolean> {
  const now = ctx.now();
  const rows = await ctx.db
    .update(wallets)
    .set({ earnLeaseUntil: new Date(now.getTime() + LEASE_MS) })
    .where(and(eq(wallets.id, pocketId), or(isNull(wallets.earnLeaseUntil), lt(wallets.earnLeaseUntil, now))))
    .returning({ id: wallets.id });
  return rows.length > 0;
}

async function release(ctx: Ctx, pocketId: string) {
  await ctx.db.update(wallets).set({ earnLeaseUntil: null }).where(eq(wallets.id, pocketId));
}

async function update(ctx: Ctx, move: EarnMove, patch: Partial<EarnMove>): Promise<EarnMove> {
  const [row] = await ctx.db
    .update(earnMoves)
    .set({ ...patch, updatedAt: ctx.now() })
    .where(eq(earnMoves.id, move.id))
    .returning();
  return row!;
}

/** Pushes a confirmed move one step; safe to call again at any point. */
export async function advanceMove(ctx: Ctx, moveId: string): Promise<EarnMove> {
  let move = await getMove(ctx, moveId);
  if (!(ACTIVE as readonly string[]).includes(move.status)) return move;
  // Switched off mid-way: the move waits, untouched, until Earn is back.
  if (!ctx.earn) return move;
  if (!(await lease(ctx, move.pocketWalletId))) return move;
  try {
    move = move.kind === "in" ? await stepIn(ctx, move) : await stepOut(ctx, ctx.earn, move);
  } catch (err) {
    console.error(`[earn] move ${move.id}`, err);
    // Shown to the person; the detail (which can name a private node) stays in the log above.
    move = await update(ctx, move, { lastError: "We couldn't reach the network for a moment. Trying again." });
  } finally {
    await release(ctx, move.pocketWalletId);
  }
  return move;
}

async function walletsOf(ctx: Ctx, move: EarnMove) {
  const [pocket] = await ctx.db.select().from(wallets).where(eq(wallets.id, move.pocketWalletId)).limit(1);
  const main = await mainWallet(ctx, move.userId);
  if (!pocket || !main) throw new Error("Earning pocket or main wallet missing");
  return { pocket, main };
}

async function stepIn(ctx: Ctx, move: EarnMove): Promise<EarnMove> {
  const { pocket, main } = await walletsOf(ctx, move);
  const amount = BigInt(move.amount);
  if (!(await findProviderTx(ctx, move.id, "earn-in")) && (await paymentUnderWay(ctx, main))) return move;
  let row = await submitOnce(ctx, move.id, "earn-in", 1, (idempotencyKey) =>
    ctx.wallets.transferUsdc({
      walletId: main.providerWalletId,
      to: pocket.address as Address,
      amount,
      idempotencyKey,
      refId: `earn-in:${move.id}`,
    }),
  );
  row = await refreshProviderTx(ctx, row);
  if (row.status === "pending") return move;
  if (row.status === "failed") {
    return update(ctx, move, { status: "failed", lastError: "The move to your Earning pocket didn't go through. Nothing left your balance." });
  }
  const done = await update(ctx, move, { status: "done", txHash: row.txHash, doneAt: ctx.now() });
  await notify(ctx, move.userId, {
    sourceKey: `earn:${move.id}:done`,
    kind: "earn_in",
    title: `$${formatUsdc(amount)} moved to your Earning pocket`,
    body: "It starts earning within about a minute.",
    href: "/earn",
    amount: formatUsdc(amount),
    email: false,
  });
  return done;
}

async function stepOut(ctx: Ctx, earn: EarnProvider, move: EarnMove): Promise<EarnMove> {
  const { pocket, main } = await walletsOf(ctx, move);
  const owner = pocket.address as Address;
  const wanted = BigInt(move.amount);
  if (move.status === "confirmed" || move.status === "withdrawing") {
    // Only what the pocket doesn't already hold comes out of the vault, so a retry after a
    // withdrawal that landed (but wasn't recorded) never withdraws twice.
    const idle = await ctx.chain.usdcBalance(owner);
    const short = wanted > idle ? wanted - idle : 0n;
    if (short > 0n) {
      const { assets } = await earn.position(owner);
      // A withdrawal already sent whose wait never finished (a timeout or a crash). Only this
      // pocket's leased worker withdraws, so the position dropping means it landed.
      const sent = move.withdrawAt !== null && move.withdrawFrom !== null;
      const landed = sent && assets < BigInt(move.withdrawFrom!);
      if (sent && !landed && ctx.now().getTime() - move.withdrawAt!.getTime() < WITHDRAW_PENDING_MS) return move;
      const need = min(short, assets);
      if (!landed && need > 0n) {
        move = await update(ctx, move, { status: "withdrawing", withdrawFrom: assets.toString(), withdrawAt: ctx.now() });
        const { txHash } = await earn.withdraw(owner, need);
        move = await update(ctx, move, { txHash });
      }
    }
    move = await update(ctx, move, { status: "returning" });
  }
  // The vault can round shares down by a unit, so what is sent back is fixed once, from what arrived.
  if (!(await findProviderTx(ctx, move.id, "earn-out"))) {
    const send = min(wanted, await ctx.chain.usdcBalance(owner));
    if (send === 0n) return move;
    if (send !== wanted) move = await update(ctx, move, { amount: send.toString() });
  }
  const amount = BigInt(move.amount);
  let row = await submitOnce(ctx, move.id, "earn-out", 1, (idempotencyKey) =>
    ctx.wallets.transferUsdc({
      walletId: pocket.providerWalletId,
      to: main.address as Address,
      amount,
      idempotencyKey,
      refId: `earn-out:${move.id}`,
    }),
  );
  row = await refreshProviderTx(ctx, row);
  if (row.status === "pending") return move;
  if (row.status === "failed") {
    return update(ctx, move, {
      status: "failed",
      lastError: "It couldn't go back to your spendable balance. It is safe in your Earning pocket; try again.",
    });
  }
  const done = await update(ctx, move, { status: "done", doneAt: ctx.now() });
  await notify(ctx, move.userId, {
    sourceKey: `earn:${move.id}:done`,
    kind: "earn_out",
    title: `$${formatUsdc(amount)} is back in your spendable balance`,
    body: "It came out of your Earning pocket.",
    href: "/earn",
    amount: formatUsdc(amount),
    email: false,
  });
  return done;
}

/** Puts an Earning pocket's idle USDC into the vault. Reads the balance first, so repeats deposit nothing. */
export async function depositIdle(ctx: Ctx, pocket: Wallet): Promise<EarnMove | null> {
  if (!ctx.earn || !pocket.earn) return null;
  const [leaving] = await ctx.db
    .select({ id: earnMoves.id })
    .from(earnMoves)
    .where(and(eq(earnMoves.pocketWalletId, pocket.id), eq(earnMoves.kind, "out"), inArray(earnMoves.status, [...ACTIVE])))
    .limit(1);
  if (leaving) return null;
  if (!(await lease(ctx, pocket.id))) return null;
  try {
    const idle = await ctx.chain.usdcBalance(pocket.address as Address);
    if (idle < ctx.limits.earnDepositMin) return null;
    const { txHash } = await ctx.earn.deposit(pocket.address as Address, idle);
    const [move] = await ctx.db
      .insert(earnMoves)
      .values({
        userId: pocket.userId,
        pocketWalletId: pocket.id,
        kind: "deposit",
        amount: idle.toString(),
        status: "done",
        txHash,
        createdAt: ctx.now(),
        updatedAt: ctx.now(),
        doneAt: ctx.now(),
      })
      .returning();
    return move!;
  } finally {
    await release(ctx, pocket.id);
  }
}

/** The sweeper's Earn pass: finish moves, then put idle Earning-pocket money into the vault. */
export async function sweepEarn(ctx: Ctx, limit = 25): Promise<number> {
  if (!ctx.earn) return 0;
  let worked = 0;
  const active = await ctx.db
    .select({ id: earnMoves.id })
    .from(earnMoves)
    .where(inArray(earnMoves.status, [...ACTIVE]))
    .limit(limit);
  for (const { id } of active) {
    await advanceMove(ctx, id);
    worked++;
  }
  const pockets = await ctx.db.select().from(wallets).where(eq(wallets.earn, true)).limit(limit);
  for (const pocket of pockets) {
    try {
      if (await depositIdle(ctx, pocket)) worked++;
    } catch (err) {
      console.error(`[earn] deposit ${pocket.id}`, err);
    }
  }
  return worked;
}
