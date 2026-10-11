import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  defineChain,
  erc20Abi,
  fallback,
  http,
  parseEventLogs,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { splitsRouterAbi } from "./abi";
import type { ChainReader, OnchainSplit, RouterReceipt } from "./types";

export type ViemChainOptions = {
  chainId: number;
  rpcUrls: string[];
  explorerUrl: string;
  router: Address;
  usdc: Address;
};

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
    transport: fallback(opts.rpcUrls.map((url) => http(url, { timeout: 10_000, retryCount: 2 }))),
  });

  return {
    usdcBalance: (owner) =>
      client.readContract({ address: opts.usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),

    usdcAllowance: (owner, spender) =>
      client.readContract({ address: opts.usdc, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),

    refUsed: (payer, ref) =>
      client.readContract({ address: opts.router, abi: splitsRouterAbi, functionName: "refUsed", args: [payer, ref] }),

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
