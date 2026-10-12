import { createPublicClient, decodeEventLog, erc20Abi, http, TransactionReceiptNotFoundError, type Address, type Hex, type PublicClient } from "viem";
import { transmitterAbi } from "./cctp";
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

/** viem readers, one client per chain; RPC from SOURCE_RPCS ("base=https://…,arb=…") or a public default. */
export function createSourceReader(network: CrossNetwork, rpcOverrides: Record<string, string> = {}): SourceReader {
  const clients = new Map<string, PublicClient>();
  const client = (chain: SourceChain) => {
    let c = clients.get(chain.key);
    if (!c) {
      c = createPublicClient({ transport: http(rpcOverrides[chain.key] ?? chain.rpc[network], { retryCount: 2, timeout: 10_000 }) }) as PublicClient;
      clients.set(chain.key, c);
    }
    return c;
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
  };
}
