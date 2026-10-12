import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { encodeApprove, encodeDepositForBurn, encodeReceiveMessage, maxFeeFor, nonceOf, parseBurnMessage } from "../crosschain/cctp";
import { SOURCE_CHAINS, type ChainKey, type SourceChain } from "../crosschain/chains";
import { IrisRateLimited } from "../crosschain/iris";
import type { Ctx } from "../context";
import type { ProviderTx } from "../wallets/types";
import { depositMoves, deposits, depositWallets } from "../db/schema";
import { deterministicUuid } from "../domain/ids";
import { mainWallet } from "./users";
import { notify } from "./notifications";

/**
 * Deposits from other chains, moved to the person's Arc address with CCTP V2.
 *
 * A deposit is recorded only after its own chain confirms it (USDC, to that wallet, that amount);
 * a webhook or a listing is a hint, never the truth. Each deposit wallet moves one batch at a time
 * (a unique index): the move burns the wallet's whole USDC balance, so small deposits ride along
 * with the next one. Every provider call carries a key derived from the move, its step and its
 * attempt, so a retry after a crash returns the original transaction instead of a second burn.
 * The mint on Arc is submitted by the treasury unless someone already minted that message.
 */

const LEASE_MS = 30_000;
const POLL_EVERY_MS = 30_000;
const POLL_RECENT_MS = 7 * 24 * 60 * 60_000;
/** Older addresses are still checked, hourly, in case a webhook was lost. */
const POLL_OLD_EVERY_MS = 60 * 60_000;
const STUCK_AFTER_MS = 30 * 60_000;
/** A burn Circle called confirmed but Iris never saw is checked on its chain after this long. */
const UNSEEN_BURN_MS = 15 * 60_000;
/** A failing step waits 30s, 1m, 2m … up to an hour between tries, and stops after this many. */
const MAX_ATTEMPTS = 8;
const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** (attempts - 1), 60 * 60_000);
const ACTIVE = ["burning", "attesting", "minting"] as const;

type Move = typeof depositMoves.$inferSelect;
type DepositRow = typeof deposits.$inferSelect;

/** Cents, rounded down: what a notification may promise (the balance itself is exact). */
const usd = (units: bigint) => `${units / 1_000_000n}.${((units % 1_000_000n) / 10_000n).toString().padStart(2, "0")}`;
const chainOf = (key: string): SourceChain => SOURCE_CHAINS[key as ChainKey];

/** One reported inbound transfer to a deposit wallet. Verified on its chain before it counts. */
export async function recordInbound(ctx: Ctx, input: { walletId: string; txHash: Hex }): Promise<"recorded" | "duplicate" | "ignored"> {
  const [wallet] = await ctx.db.select().from(depositWallets).where(eq(depositWallets.providerWalletId, input.walletId)).limit(1);
  if (!wallet) return "ignored";
  const chain = chainOf(wallet.chain);
  if (!chain || !ctx.crossChain.chains.some((c) => c.key === chain.key)) return "ignored";
  const sourceTxId = `${chain.key}:${input.txHash.toLowerCase()}`;
  // Already recorded: no need to ask the chain again (polling re-lists the same transfers).
  const [known] = await ctx.db.select({ id: deposits.id }).from(deposits).where(eq(deposits.sourceTxId, sourceTxId)).limit(1);
  if (known) return "duplicate";
  const seen = await ctx.crossChain.reader.verifyInbound(chain, input.txHash, wallet.address as Address);
  if (!seen.ok) {
    console.warn(`[deposits] ${chain.name} ${input.txHash} isn't a USDC transfer to ${wallet.address}; ignored`);
    return "ignored";
  }
  const rows = await ctx.db
    .insert(deposits)
    .values({
      userId: wallet.userId,
      depositWalletId: wallet.id,
      chain: chain.key,
      sourceTxId,
      sourceTxHash: input.txHash,
      amount: seen.amount.toString(),
      status: "detected",
      createdAt: ctx.now(),
      updatedAt: ctx.now(),
    })
    .onConflictDoNothing()
    .returning({ id: deposits.id });
  return rows.length ? "recorded" : "duplicate";
}

/**
 * Backup for missed webhooks: asks Circle for recent inbound transfers on deposit wallets, every
 * 30 seconds for those opened in the last week (or holding a deposit that waits), hourly for the rest.
 */
export async function pollDepositWallets(ctx: Ctx, limit = 10): Promise<number> {
  const now = ctx.now();
  const keys = ctx.crossChain.chains.map((c) => c.key);
  if (!keys.length) return 0;
  const waiting = ctx.db.select({ id: deposits.depositWalletId }).from(deposits).where(eq(deposits.status, "waiting"));
  const due = await ctx.db
    .select()
    .from(depositWallets)
    .where(
      and(
        inArray(depositWallets.chain, keys),
        or(
          isNull(depositWallets.polledAt),
          lt(depositWallets.polledAt, new Date(now.getTime() - POLL_OLD_EVERY_MS)),
          and(
            lt(depositWallets.polledAt, new Date(now.getTime() - POLL_EVERY_MS)),
            or(gt(depositWallets.createdAt, new Date(now.getTime() - POLL_RECENT_MS)), inArray(depositWallets.id, waiting)),
          ),
        ),
      ),
    )
    .orderBy(sql`${depositWallets.polledAt} asc nulls first`)
    .limit(limit);
  let found = 0;
  for (const w of due) {
    await ctx.db.update(depositWallets).set({ polledAt: now }).where(eq(depositWallets.id, w.id));
    try {
      for (const tx of await ctx.wallets.listInbound(w.providerWalletId, 10, { confirmed: true })) {
        if ((await recordInbound(ctx, { walletId: w.providerWalletId, txHash: tx.txHash })) === "recorded") found++;
      }
    } catch (err) {
      console.error(`[deposits] polling ${w.chain} wallet ${w.id} failed`, err);
    }
  }
  return found;
}

/** Opens moves for wallets with new deposits, then steps every active move under a lease. */
export async function advanceDeposits(ctx: Ctx, limit = 10): Promise<number> {
  await openMoves(ctx, limit);
  const now = ctx.now();
  const active = await ctx.db
    .select({ id: depositMoves.id })
    .from(depositMoves)
    .where(and(inArray(depositMoves.status, [...ACTIVE]), or(isNull(depositMoves.leaseUntil), lt(depositMoves.leaseUntil, now)), dueAfterFailures(now)))
    .orderBy(asc(depositMoves.updatedAt))
    .limit(limit);
  let moved = 0;
  for (const { id } of active) {
    const [move] = await ctx.db
      .update(depositMoves)
      .set({ leaseUntil: new Date(now.getTime() + LEASE_MS) })
      .where(and(eq(depositMoves.id, id), inArray(depositMoves.status, [...ACTIVE]), or(isNull(depositMoves.leaseUntil), lt(depositMoves.leaseUntil, now))))
      .returning();
    if (!move) continue;
    try {
      await stepMove(ctx, move);
      moved++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!(err instanceof IrisRateLimited)) console.error(`[deposits] move ${move.id}`, err);
      await ctx.db.update(depositMoves).set({ lastError: message.slice(0, 300), updatedAt: ctx.now() }).where(eq(depositMoves.id, move.id));
    } finally {
      await ctx.db.update(depositMoves).set({ leaseUntil: null }).where(eq(depositMoves.id, move.id));
    }
  }
  return moved;
}

/**
 * A move whose last step failed waits longer after each try (counted from that failure; progress
 * since clears it), and stops after MAX_ATTEMPTS. The person has been told it is slow by then.
 */
function dueAfterFailures(now: Date) {
  return and(
    lt(depositMoves.attempts, MAX_ATTEMPTS),
    or(
      eq(depositMoves.attempts, 0),
      isNull(depositMoves.lastError),
      ...Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) =>
        and(eq(depositMoves.attempts, i + 1), lt(depositMoves.updatedAt, new Date(now.getTime() - backoffMs(i + 1)))),
      ),
    ),
  );
}

async function openMoves(ctx: Ctx, limit: number) {
  // Only wallets with a new deposit: one that waits for more has nothing to do until more arrives,
  // and it must never take a slot from someone else's.
  const pending = await ctx.db
    .selectDistinct({ walletId: deposits.depositWalletId })
    .from(deposits)
    .where(eq(deposits.status, "detected"))
    .limit(limit);
  for (const { walletId } of pending) {
    const [wallet] = await ctx.db.select().from(depositWallets).where(eq(depositWallets.id, walletId)).limit(1);
    if (!wallet) continue;
    const chain = chainOf(wallet.chain);
    if (!ctx.crossChain.chains.some((c) => c.key === chain.key)) continue;
    const [busy] = await ctx.db
      .select({ id: depositMoves.id })
      .from(depositMoves)
      .where(and(eq(depositMoves.depositWalletId, wallet.id), inArray(depositMoves.status, [...ACTIVE])))
      .limit(1);
    if (busy) continue;

    // USDC reaches the chain before Circle reports it, so a move can burn money whose deposit is
    // recorded only afterwards. Such a deposit joins the move that already carried it, but only if
    // its money has really left: while the balance still holds it, it waits for its own move.
    const balance = await ctx.crossChain.reader.usdcBalance(chain, wallet.address as Address);
    for (const d of await ctx.db.select().from(deposits).where(and(eq(deposits.depositWalletId, wallet.id), eq(deposits.status, "detected")))) {
      if (balance < BigInt(d.amount)) await attachToEarlierMove(ctx, d);
    }

    const waitingRows = await ctx.db
      .select()
      .from(deposits)
      .where(and(eq(deposits.depositWalletId, wallet.id), inArray(deposits.status, ["detected", "waiting"])));
    if (balance < chain.minUnits) {
      for (const d of waitingRows.filter((r) => r.status === "detected")) {
        await ctx.db.update(deposits).set({ status: "waiting", updatedAt: ctx.now() }).where(and(eq(deposits.id, d.id), eq(deposits.status, "detected")));
        // At most once a day per address, in the app only: anyone can send dust to a public address.
        await notify(ctx, d.userId, {
          sourceKey: `deposit:${wallet.id}:waiting:${ctx.now().toISOString().slice(0, 10)}`,
          kind: "deposit_waiting",
          title: `$${usd(BigInt(d.amount))} arrived on ${chain.name}`,
          body: `It moves to Arc once you have $${usd(chain.minUnits)} there.`,
          href: "/home",
          amount: usd(BigInt(d.amount)),
          email: false,
        });
      }
      continue;
    }

    const [move] = await ctx.db
      .insert(depositMoves)
      .values({ depositWalletId: wallet.id, userId: wallet.userId, chain: chain.key, status: "burning", burnAmount: balance.toString(), createdAt: ctx.now(), updatedAt: ctx.now() })
      .onConflictDoNothing()
      .returning();
    if (!move) continue; // another worker opened it first
    for (const d of waitingRows) {
      const [attached] = await ctx.db
        .update(deposits)
        .set({ status: "moving", moveId: move.id, updatedAt: ctx.now() })
        .where(and(eq(deposits.id, d.id), inArray(deposits.status, ["detected", "waiting"])))
        .returning({ id: deposits.id });
      if (attached && d.status === "detected") {
        await notify(ctx, d.userId, {
          sourceKey: `deposit:${d.id}:arrived`,
          kind: "deposit_arrived",
          title: `$${usd(BigInt(d.amount))} arrived on ${chain.name}`,
          body: "Moving it to Arc. It will be ready to spend in about a minute.",
          href: "/home",
          amount: usd(BigInt(d.amount)),
          email: false,
        });
      }
    }
  }
}

/** Attaches a late-recorded deposit to the move whose burn already included it, if any. */
async function attachToEarlierMove(ctx: Ctx, d: DepositRow): Promise<boolean> {
  const moves = await ctx.db
    .select({
      id: depositMoves.id,
      status: depositMoves.status,
      burnAmount: depositMoves.burnAmount,
      attached: sql<string>`coalesce((select sum(${deposits.amount}::numeric) from ${deposits} where ${deposits.moveId} = ${depositMoves.id}), 0)::text`,
    })
    .from(depositMoves)
    .where(eq(depositMoves.depositWalletId, d.depositWalletId))
    .orderBy(desc(depositMoves.createdAt));
  const carrier = moves.find((m) => BigInt(m.burnAmount) - BigInt(m.attached.split(".")[0]!) >= BigInt(d.amount));
  if (!carrier) return false;
  const [attached] = await ctx.db
    .update(deposits)
    .set({ status: carrier.status === "ready" ? "ready" : "moving", moveId: carrier.id, updatedAt: ctx.now() })
    .where(and(eq(deposits.id, d.id), eq(deposits.status, "detected")))
    .returning({ id: deposits.id });
  return Boolean(attached);
}

/** Circle needs UUID keys: a deterministic one per move, step and attempt, so retries resume. */
/**
 * A provider transaction is on chain once Circle reports it COMPLETE, or CONFIRMED with a hash.
 * Circle takes many minutes to say COMPLETE on some chains; Fast Transfer is attested at the
 * confirmed level, and each next step is checked on chain anyway (Iris attests only burns it has
 * seen; a mint counts only once Arc marks its nonce used).
 */
const landed = (tx: ProviderTx) => tx.status === "complete" || (tx.status === "pending" && tx.rawState === "CONFIRMED" && Boolean(tx.txHash));

const key = (move: Move, step: string) => deterministicUuid(`deposit-move:${move.id}:${step}:${move.attempts}`);

async function save(ctx: Ctx, move: Move, patch: Partial<Move>) {
  await ctx.db
    .update(depositMoves)
    .set({ lastError: null, ...patch, updatedAt: ctx.now() })
    .where(eq(depositMoves.id, move.id));
}

async function stepMove(ctx: Ctx, move: Move): Promise<void> {
  const chain = chainOf(move.chain);
  const [wallet] = await ctx.db.select().from(depositWallets).where(eq(depositWallets.id, move.depositWalletId)).limit(1);
  const recipient = (await mainWallet(ctx, move.userId))?.address as Address | undefined;
  if (!wallet || !recipient) throw new Error("Deposit wallet or Arc wallet missing");
  const { cctp, iris, network } = ctx.crossChain;
  const amount = BigInt(move.burnAmount);
  await reportIfSlow(ctx, move, chain);

  if (move.status === "burning") {
    // Approve, then burn. Keys carry the attempt, so a crash resumes the same transaction.
    const approve = await ctx.wallets.execute({
      walletId: wallet.providerWalletId,
      contract: chain.usdc[network],
      callData: encodeApprove(cctp.tokenMessenger, amount),
      idempotencyKey: key(move, "approve"),
      refId: `deposit-move:${move.id}`,
    });
    if (move.approveProviderTx !== approve.providerTxId) await save(ctx, move, { approveProviderTx: approve.providerTxId });
    const approved = await ctx.wallets.getTx(approve.providerTxId);
    if (approved.status === "failed") return retry(ctx, move, `approve failed: ${approved.error ?? approved.rawState}`);
    if (!landed(approved)) return;

    const fees = await iris.fees(chain.domain);
    const maxFee = move.maxFee ? BigInt(move.maxFee) : maxFeeFor(amount, chain.fast ? fees.fastBps : fees.standardBps);
    const burn = await ctx.wallets.execute({
      walletId: wallet.providerWalletId,
      contract: cctp.tokenMessenger,
      callData: encodeDepositForBurn({ amount, mintRecipient: recipient, burnToken: chain.usdc[network], maxFee, fast: chain.fast }),
      idempotencyKey: key(move, "burn"),
      refId: `deposit-move:${move.id}`,
    });
    if (move.burnProviderTx !== burn.providerTxId) await save(ctx, move, { burnProviderTx: burn.providerTxId, maxFee: maxFee.toString() });
    const burned = await ctx.wallets.getTx(burn.providerTxId);
    if (burned.status === "failed") return retry(ctx, move, `burn failed: ${burned.error ?? burned.rawState}`);
    if (!landed(burned) || !burned.txHash) return;
    await save(ctx, move, { status: "attesting", burnTxHash: burned.txHash, lastError: null });
    return;
  }

  if (move.status === "attesting") {
    const msg = await iris.message(chain.domain, move.burnTxHash as Hex);
    if (msg.status === "missing" && ctx.now().getTime() - move.updatedAt.getTime() > UNSEEN_BURN_MS) {
      // Circle called the burn confirmed, yet Iris never saw it. If its chain has no successful
      // receipt either (reverted, or dropped in a reorg), nothing was burned: burn again.
      const receipt = await ctx.crossChain.reader.receiptStatus(chain, move.burnTxHash as Hex);
      if (receipt !== "success") {
        await save(ctx, move, {
          status: "burning",
          attempts: move.attempts + 1,
          approveProviderTx: null,
          burnProviderTx: null,
          burnTxHash: null,
          lastError: `burn ${move.burnTxHash} ${receipt ?? "not found"} on ${chain.name}; burning again`,
        });
      }
      return;
    }
    if (msg.status !== "complete") return;
    const parsed = parseBurnMessage(msg.message);
    // Only ever mint what this move burned, to this person, from this chain.
    if (parsed.mintRecipient.toLowerCase() !== recipient.toLowerCase() || parsed.amount !== amount || parsed.sourceDomain !== chain.domain) {
      throw new Error("Attested message doesn't match the burn; not minting");
    }
    await save(ctx, move, { status: "minting", message: msg.message, attestation: msg.attestation, nonce: nonceOf(msg.message), lastError: null });
    return;
  }

  // minting
  const message = move.message as Hex;
  const parsed = parseBurnMessage(message);
  if (!(await ctx.chain.cctpNonceUsed(cctp.messageTransmitter, move.nonce as Hex))) {
    const mint = await ctx.wallets.execute({
      walletId: ctx.treasuryWalletId,
      contract: cctp.messageTransmitter,
      callData: encodeReceiveMessage(message, move.attestation as Hex),
      idempotencyKey: key(move, "mint"),
      refId: `deposit-move:${move.id}`,
    });
    if (move.mintProviderTx !== mint.providerTxId) await save(ctx, move, { mintProviderTx: mint.providerTxId });
    const minted = await ctx.wallets.getTx(mint.providerTxId);
    if (minted.status === "pending" && !landed(minted)) return;
    if (landed(minted) && minted.txHash) await save(ctx, move, { mintTxHash: minted.txHash });
    // A failed mint is fine if someone else minted it meanwhile; the nonce check decides.
    if (!(await ctx.chain.cctpNonceUsed(cctp.messageTransmitter, move.nonce as Hex))) {
      if (minted.status === "failed") return retry(ctx, move, `mint failed: ${minted.error ?? minted.rawState}`);
      return;
    }
  } else if (move.mintProviderTx && !move.mintTxHash) {
    // Our mint landed between two sweeps: record its hash (receipts and activity name it by that).
    const minted = await ctx.wallets.getTx(move.mintProviderTx);
    if (landed(minted) && minted.txHash) await save(ctx, move, { mintTxHash: minted.txHash });
  }
  await finish(ctx, move, chain, parsed.amount - parsed.feeExecuted);
}

async function retry(ctx: Ctx, move: Move, error: string) {
  await save(ctx, move, { attempts: move.attempts + 1, lastError: error.slice(0, 300) });
}

async function reportIfSlow(ctx: Ctx, move: Move, chain: SourceChain) {
  if (move.stuckNotifiedAt || ctx.now().getTime() - move.createdAt.getTime() < STUCK_AFTER_MS) return;
  await save(ctx, move, { stuckNotifiedAt: ctx.now() });
  await notify(ctx, move.userId, {
    sourceKey: `move:${move.id}:stuck`,
    kind: "deposit_stuck",
    title: `Your $${usd(BigInt(move.burnAmount))} is safe on ${chain.name}`,
    body: "Moving it to Arc is taking longer than usual; Splits keeps trying.",
    href: "/home",
    amount: usd(BigInt(move.burnAmount)),
    email: true,
  });
}

async function finish(ctx: Ctx, move: Move, chain: SourceChain, minted: bigint) {
  const [done] = await ctx.db
    .update(depositMoves)
    .set({ status: "ready", mintedAmount: minted.toString(), lastError: null, updatedAt: ctx.now() })
    .where(and(eq(depositMoves.id, move.id), inArray(depositMoves.status, [...ACTIVE])))
    .returning({ id: depositMoves.id });
  if (!done) return;
  await ctx.db.update(deposits).set({ status: "ready", updatedAt: ctx.now() }).where(eq(deposits.moveId, move.id));
  await notify(ctx, move.userId, {
    sourceKey: `move:${move.id}:ready`,
    kind: "deposit_ready",
    title: `Ready: $${usd(minted)} is in your balance`,
    body: `It arrived from ${chain.name} and is ready to split.`,
    href: "/home",
    amount: usd(minted),
    email: true,
  });
}

/** The latest deposit for the Receive screen's status line. */
export async function latestDepositFor(ctx: Ctx, userId: string) {
  const [row] = await ctx.db
    .select({ d: deposits, m: depositMoves })
    .from(deposits)
    .leftJoin(depositMoves, eq(depositMoves.id, deposits.moveId))
    .where(eq(deposits.userId, userId))
    .orderBy(desc(deposits.createdAt))
    .limit(1);
  if (!row) return null;
  const d: DepositRow = row.d;
  const chain = chainOf(d.chain);
  return {
    id: d.id,
    chain: d.chain,
    chainName: chain?.name ?? d.chain,
    amount: usd(BigInt(d.amount)),
    status: d.status,
    minted: row.m?.mintedAmount ? usd(BigInt(row.m.mintedAmount)) : null,
    stuck: Boolean(row.m?.stuckNotifiedAt) && row.m?.status !== "ready",
    at: d.createdAt.toISOString(),
  };
}
