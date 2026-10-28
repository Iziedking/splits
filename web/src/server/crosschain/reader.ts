import { createPublicClient, decodeEventLog, erc20Abi, getAddress, http, TransactionReceiptNotFoundError, type Address, type Hex, type PublicClient } from "viem";
import { depositForBurnEvent, parseDepositForBurnLogs, transmitterAbi, type BurnLog } from "./cctp";
import { CCTP, type CrossNetwork, type SourceChain } from "./chains";

/** Reads USDC on the chains deposits arrive on. The webhook says "money came"; this checks it. */
export interface SourceReader {
  usdcBalance(chain: SourceChain, address: Address): Promise<bigint>;
  /** The USDC that `txHash` moved to `to` on that chain, if it succeeded. Throws if the chain can't be read. */
  verifyInbound(chain: SourceChain, txHash: Hex, to: Address): Promise<{ ok: true; amount: bigint } | { ok: false }>;
  /** Whether `txHash` is on that chain and succeeded; null if the chain has no such transaction. */
  receiptStatus(chain: SourceChain, txHash: Hex): Promise<"success" | "reverted" | null>;
  /** The CCTP domain the chain's MessageTransmitterV2 reports (startup sanity check). */
  cctpDomain(chain: SourceChain): Promise<number>;
  /** The EVM chain id the RPC reports (startup sanity check). */
  chainId(chain: SourceChain): Promise<number>;
  /** The burn receipt: who sent it, its nonce, and the DepositForBurn events in it; null if unknown. */
  burnReceipt(chain: SourceChain, txHash: Hex): Promise<{ status: "success" | "reverted"; from: Address; nonce: number; burns: BurnLog[] } | null>;
  /** Burns by `depositor` from `fromBlock` on, for payers whose page closed before reporting a hash. */
  burnsFrom(chain: SourceChain, depositor: Address, fromBlock: bigint): Promise<{ txHash: Hex; burn: BurnLog }[]>;
  /** The account's next nonce on that chain (counting mined transactions only). */
  pendingNonce(chain: SourceChain, address: Address): Promise<number>;
  /** The nonce a known (possibly unmined) transaction was sent with; null if the node never saw it. */
  transactionNonce(chain: SourceChain, txHash: Hex): Promise<number | null>;
  blockNumber(chain: SourceChain): Promise<bigint>;
}

type LogLike = { address: string; topics: Hex[]; data: Hex };

/** Sums USDC Transfer events to `to` emitted by the real USDC contract; anything else is ignored. */
export function sumUsdcTransfers(logs: LogLike[], usdc: Address, to: Address): bigint {
  let total = 0n;
  for (const log of logs) {
    if (log.address.toLowerCase() !== usdc.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "Transfer" && ev.args.to.toLowerCase() === to.toLowerCase()) total += ev.args.value;
    } catch {
      // Not a Transfer (Approval, or another event the token emits).
    }
  }
  return total;
}

/** A source-chain receipt as the burn check needs it: only TokenMessenger burns, and none if it reverted. */
export function burnsInReceipt(
  receipt: { status: "success" | "reverted"; from: Address; logs: LogLike[] },
  tokenMessenger: Address,
  nonce: number,
): { status: "success" | "reverted"; from: Address; nonce: number; burns: BurnLog[] } {
  return {
    status: receipt.status,
    from: getAddress(receipt.from),
    nonce,
    burns: receipt.status === "success" ? parseDepositForBurnLogs(receipt.logs, tokenMessenger) : [],
  };
}

/** The narrowest getLogs range worth trying; an RPC that refuses even this is down, not picky. */
const MIN_LOG_RANGE = 10;

/**
 * An RPC refusing a getLogs call as too wide ("limited to a 200 range", "block range too large",
 * "query returned more than 10000 results"). A rate limit or an outage is not one: narrowing won't help.
 */
export function isRangeRefusal(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${(err as { details?: string }).details ?? ""}` : String(err);
  return /range|too large|more than/i.test(text);
}

/**
 * getLogs over [from, to] in pieces no wider than `range` blocks, halving the piece whenever the RPC
 * refuses one as too wide. Returns the logs and the width that worked, for the next search to start at.
 */
export async function getLogsInPieces<T>(
  getLogs: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  to: bigint,
  range: number,
): Promise<{ logs: T[]; range: number }> {
  const logs: T[] = [];
  let start = from;
  while (start <= to) {
    const end = start + BigInt(range) - 1n > to ? to : start + BigInt(range) - 1n;
    try {
      logs.push(...(await getLogs(start, end)));
      start = end + 1n;
    } catch (err) {
      if (range <= MIN_LOG_RANGE || !isRangeRefusal(err)) throw err;
      range = Math.max(MIN_LOG_RANGE, Math.floor(range / 2));
    }
  }
  return { logs, range };
}

/** Blocks this close to the head are searched again on every call: a reorg can still move a burn there. */
const REORG_BLOCKS = 64n;
/** How long a payer's search is kept: longer than the 2 hours crossPay keeps looking for stray burns. */
const SCAN_KEPT_MS = 3 * 3_600_000;
const MAX_SCANS = 2_000;

type FoundBurn = { txHash: Hex; burn: BurnLog; block: bigint };
/** Where `burnsFrom` has searched for one depositor on one chain, up to a block a reorg can't undo. */
type Scan = { from: bigint; to: bigint; burns: FoundBurn[]; usedAt: number };

/** viem readers, one client per chain; RPC from SOURCE_RPCS ("base=https://…,arb=…") or a public default. */
export function createSourceReader(
  network: CrossNetwork,
  rpcOverrides: Record<string, string> = {},
  makeClient: (url: string) => PublicClient = (url) => createPublicClient({ transport: http(url, { retryCount: 2, timeout: 10_000 }) }) as PublicClient,
): SourceReader {
  const clients = new Map<string, PublicClient>();
  const client = (chain: SourceChain) => {
    let c = clients.get(chain.key);
    if (!c) {
      c = makeClient(rpcOverrides[chain.key] ?? chain.rpc[network]);
      clients.set(chain.key, c);
    }
    return c;
  };
  // The widest range each chain's RPC has served, learned from refusals.
  const logRanges = new Map<string, number>();
  const scans = new Map<string, Scan>();
  const searchBurns = async (chain: SourceChain, depositor: Address, from: bigint, to: bigint): Promise<FoundBurn[]> => {
    if (from > to) return [];
    const { logs, range } = await getLogsInPieces(
      (fromBlock, toBlock) => client(chain).getLogs({ address: CCTP[network].tokenMessenger, event: depositForBurnEvent, args: { depositor }, fromBlock, toBlock }),
      from,
      to,
      logRanges.get(chain.key) ?? chain.logRange[network],
    );
    logRanges.set(chain.key, range);
    return logs.flatMap((log) =>
      parseDepositForBurnLogs([log as unknown as LogLike], CCTP[network].tokenMessenger).map((burn) => ({ txHash: log.transactionHash!, burn, block: log.blockNumber! })),
    );
  };
  const keep = (key: string, scan: Scan) => {
    scans.delete(key);
    scans.set(key, scan);
    for (const [k, s] of scans) {
      if (scans.size <= MAX_SCANS && s.usedAt > scan.usedAt - SCAN_KEPT_MS) break;
      scans.delete(k);
    }
  };
  // "No such transaction" is an answer; an RPC that can't be reached is not, so it throws.
  const receiptOf = (chain: SourceChain, hash: Hex) =>
    client(chain)
      .getTransactionReceipt({ hash })
      .catch((err) => {
        if (err instanceof TransactionReceiptNotFoundError) return null;
        throw err;
      });
  return {
    usdcBalance: (chain, address) =>
      client(chain).readContract({ address: chain.usdc[network], abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    async verifyInbound(chain, txHash, to) {
      const receipt = await receiptOf(chain, txHash);
      if (!receipt || receipt.status !== "success") return { ok: false };
      const amount = sumUsdcTransfers(receipt.logs as LogLike[], chain.usdc[network], to);
      return amount > 0n ? { ok: true, amount } : { ok: false };
    },
    async receiptStatus(chain, txHash) {
      return (await receiptOf(chain, txHash))?.status ?? null;
    },
    async cctpDomain(chain) {
      return Number(await client(chain).readContract({ address: CCTP[network].messageTransmitter, abi: transmitterAbi, functionName: "localDomain" }));
    },
    chainId: (chain) => client(chain).getChainId(),
    async burnReceipt(chain, txHash) {
      const receipt = await receiptOf(chain, txHash);
      if (!receipt) return null;
      const tx = await client(chain).getTransaction({ hash: txHash });
      return burnsInReceipt({ status: receipt.status, from: receipt.from, logs: receipt.logs as LogLike[] }, CCTP[network].tokenMessenger, tx.nonce);
    },
    // Asked every 30 seconds for 2 hours per payment, so each call searches only the blocks since the
    // last one (plus the reorgable tail): a 100-block RPC on a fast chain can't re-read 2 hours each time.
    async burnsFrom(chain, depositor, fromBlock) {
      const latest = await client(chain).getBlockNumber();
      const key = `${chain.key}:${depositor.toLowerCase()}`;
      const kept = scans.get(key);
      const scan = kept && kept.from <= fromBlock ? kept : { from: fromBlock, to: fromBlock - 1n, burns: [], usedAt: 0 };
      const settled = latest - REORG_BLOCKS;
      if (settled > scan.to) {
        const upTo = scan.to;
        const found = await searchBurns(chain, depositor, upTo + 1n, settled);
        // A concurrent call may have searched these blocks already.
        if (scan.to === upTo) {
          scan.burns.push(...found);
          scan.to = settled;
        }
      }
      scan.usedAt = Date.now();
      keep(key, scan);
      const recent = await searchBurns(chain, depositor, scan.to + 1n > fromBlock ? scan.to + 1n : fromBlock, latest);
      return [...scan.burns, ...recent].filter((b) => b.block >= fromBlock).map(({ txHash, burn }) => ({ txHash, burn }));
    },
    pendingNonce: (chain, address) => client(chain).getTransactionCount({ address, blockTag: "latest" }),
    async transactionNonce(chain, txHash) {
      try {
        return (await client(chain).getTransaction({ hash: txHash })).nonce;
      } catch {
        return null;
      }
    },
    blockNumber: (chain) => client(chain).getBlockNumber(),
  };
}
