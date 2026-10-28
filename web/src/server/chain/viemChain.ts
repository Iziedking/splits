import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  defineChain,
  erc20Abi,
  parseEventLogs,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { transmitterAbi } from "../crosschain/cctp";
import { crossPayAbi } from "../crosschain/crossPayAbi";
import { splitsRouterAbi } from "./abi";
import { freshTransport } from "./freshness";
import type { ChainReader, CrossOutcome, OnchainSplit, RouterReceipt } from "./types";

export type ViemChainOptions = {
  chainId: number;
  rpcUrls: string[];
  explorerUrl: string;
  router: Address;
  usdc: Address;
};

const LOG_CHUNK = 10_000n;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * SplitsCrossPay's outcome for one CCTP message: the first CrossPaid or Refunded it emitted after the
 * transmitter minted `nonce`, before any later mint in the same transaction. Anyone can burn with a
 * hook naming someone else's ref and payer, so those are never what ties an event to a payment.
 */
export function outcomeAfterMint(txHash: Hex, logs: Log[], contract: Address, transmitter: Address, nonce: Hex): CrossOutcome | null {
  const sorted = [...logs].sort((a, b) => (a.logIndex ?? 0) - (b.logIndex ?? 0));
  const mints = parseEventLogs({ abi: transmitterAbi, eventName: "MessageReceived", logs: sorted }).filter((l) => same(l.address, transmitter));
  const mine = mints.find((l) => same(l.args.nonce, nonce));
  if (!mine) return null;
  const start = mine.logIndex ?? 0;
  const end = mints.find((l) => (l.logIndex ?? 0) > start)?.logIndex ?? Number.MAX_SAFE_INTEGER;
  const ours = parseEventLogs({ abi: crossPayAbi, logs: sorted }).filter(
    (l) => same(l.address, contract) && (l.logIndex ?? 0) > start && (l.logIndex ?? 0) < end,
  );
  for (const l of ours) {
    if (l.eventName === "CrossPaid") return { kind: "paid", txHash, feeBack: l.args.feeBack };
    if (l.eventName === "Refunded") {
      const after = l.logIndex ?? 0;
      const owed = ours.some((o) => o.eventName === "Owed" && (o.logIndex ?? 0) > after);
      return { kind: "refunded", txHash, amount: l.args.amount, owed };
    }
  }
  return null;
}

export function arcChain(opts: Pick<ViemChainOptions, "chainId" | "rpcUrls" | "explorerUrl">) {
  return defineChain({
    id: opts.chainId,
    name: opts.chainId === 5042 ? "Arc" : "Arc Testnet",
    // Arc's native gas token is USDC with 18 decimals. Balances in this app use the 6-decimal
    // ERC-20 interface instead, so this entry only matters to viem's internals.
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: opts.rpcUrls } },
    blockExplorers: { default: { name: "Arc Explorer", url: opts.explorerUrl } },
  });
}

export function parseRouterReceipt(
  router: Address,
  receipt: { transactionHash: Hex; status: "success" | "reverted"; blockNumber: bigint; logs: Log[] },
): RouterReceipt {
  const routerLogs = receipt.logs.filter((l) => l.address.toLowerCase() === router.toLowerCase());
  const events = parseEventLogs({ abi: splitsRouterAbi, logs: routerLogs });
  const out: RouterReceipt = {
    txHash: receipt.transactionHash,
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    splitCreated: [],
    splitLegsSet: [],
    splitSent: [],
    legPaid: [],
  };
  for (const e of events) {
    switch (e.eventName) {
      case "SplitCreated":
        out.splitCreated.push({ splitId: e.args.splitId, owner: e.args.owner });
        break;
      case "SplitLegsSet":
        out.splitLegsSet.push({ splitId: e.args.splitId, version: e.args.version });
        break;
      case "SplitSent":
        out.splitSent.push({ ...e.args, version: e.args.version });
        break;
      case "LegPaid":
        out.legPaid.push({ ...e.args });
        break;
      case "SplitActiveSet":
        break;
    }
  }
  return out;
}

export function createViemChain(opts: ViemChainOptions): ChainReader {
  const client = createPublicClient({
    chain: arcChain(opts),
    // Your node first while it keeps up; a node that falls behind is passed over (freshness.ts).
    transport: freshTransport(opts.rpcUrls),
  });

  return {
    usdcBalance: (owner) =>
      client.readContract({ address: opts.usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),

    usdcAllowance: (owner, spender) =>
      client.readContract({ address: opts.usdc, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),

    refUsed: (payer, ref, atBlock) =>
      client.readContract({ address: opts.router, abi: splitsRouterAbi, functionName: "refUsed", args: [payer, ref], blockNumber: atBlock }),

    // Simulates a 1-cent transfer to `to`. On Arc the native balance is the USDC balance, so a
    // balance override funds the simulated sender and the answer never depends on the treasury's
    // float (checked on the Arc testnet node, 2026-10-11). Only a revert means "can't receive";
    // RPC and transport errors are thrown so the caller can say the line couldn't be checked.
    async canReceive(from, to) {
      try {
        await client.simulateContract({
          account: from,
          address: opts.usdc,
          abi: erc20Abi,
          functionName: "transfer",
          args: [to, 10_000n],
          stateOverride: [{ address: from, balance: 10n ** 18n }],
        });
        return true;
      } catch (err) {
        if (err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError)) return false;
        throw err;
      }
    },

    async getSplit(splitId): Promise<OnchainSplit | null> {
      try {
        const [owner, version, active, legs] = await client.readContract({
          address: opts.router,
          abi: splitsRouterAbi,
          functionName: "getSplit",
          args: [splitId],
        });
        return { owner, version, active, legs: legs.map((l) => ({ ...l })) };
      } catch (err) {
        if (err instanceof Error && err.message.includes("SplitNotFound")) return null;
        throw err;
      }
    },

    blockNumber: () => client.getBlockNumber(),

    async cctpNonceUsed(transmitter, nonce) {
      return (await client.readContract({ address: transmitter, abi: transmitterAbi, functionName: "usedNonces", args: [nonce] })) !== 0n;
    },

    // Searched in chunks: a day of Arc blocks is more than many RPCs serve in one getLogs call.
    async findSplitSent(payer, ref, fromBlock) {
      const latest = await client.getBlockNumber();
      for (let from = fromBlock; from <= latest; from += LOG_CHUNK) {
        const to = from + LOG_CHUNK - 1n < latest ? from + LOG_CHUNK - 1n : latest;
        const logs = await client.getContractEvents({
          address: opts.router,
          abi: splitsRouterAbi,
          eventName: "SplitSent",
          args: { payer, ref },
          fromBlock: from,
          toBlock: to,
        });
        if (logs[0]) return logs[0].transactionHash;
      }
      return null;
    },

    async crossPayOutcome(contract, transmitter, nonce, fromBlock): Promise<CrossOutcome | null> {
      const latest = await client.getBlockNumber();
      for (let from = fromBlock; from <= latest; from += LOG_CHUNK) {
        const to = from + LOG_CHUNK - 1n < latest ? from + LOG_CHUNK - 1n : latest;
        const [minted] = await client.getContractEvents({
          address: transmitter,
          abi: transmitterAbi,
          eventName: "MessageReceived",
          args: { nonce },
          fromBlock: from,
          toBlock: to,
        });
        if (minted) {
          const r = await client.getTransactionReceipt({ hash: minted.transactionHash });
          return outcomeAfterMint(r.transactionHash, r.logs, contract, transmitter, nonce);
        }
      }
      return null;
    },

    async crossPayWiring(contract) {
      const code = await client.getCode({ address: contract });
      if (!code || code === "0x") return null;
      const read = (functionName: "usdc" | "transmitter" | "router" | "tokenMessenger") =>
        client.readContract({ address: contract, abi: crossPayAbi, functionName });
      const [usdc, transmitter, router, tokenMessenger] = await Promise.all([read("usdc"), read("transmitter"), read("router"), read("tokenMessenger")]);
      return { usdc, transmitter, router, tokenMessenger };
    },

    async receipt(txHash) {
      try {
        const r = await client.getTransactionReceipt({ hash: txHash });
        return parseRouterReceipt(opts.router, r);
      } catch (err) {
        if (err instanceof TransactionReceiptNotFoundError) return null;
        throw err;
      }
    },
  };
}
