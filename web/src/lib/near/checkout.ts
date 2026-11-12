/**
 * Split Checkout: pay a saved split from another chain through NEAR Intents (the 1Click API).
 *
 * The payer sends a coin on their own chain to a deposit address 1Click gives us. 1Click swaps it
 * and withdraws exactly the asked amount of USDC on NEAR mainnet to the router with
 * `ft_transfer_call`, passing our message ({ref, to, version}), so the router divides it by the
 * recipient's saved split as it arrives. Intents has no testnet, so checkout is mainnet only, even
 * when the rest of NEAR mode runs on testnet. Checked against the 1Click OpenAPI on 2026-11-12.
 */
import { CENT, MAX_REF_BYTES } from "./payment";

export const CHECKOUT = {
  /** The splits-router on NEAR mainnet, read on the server at run time (prod.env). Empty: checkout is off. */
  get router(): string {
    return process.env.NEAR_CHECKOUT_ROUTER ?? "";
  },
  /** Circle's native USDC on NEAR mainnet (6 decimals), as 1Click lists it. */
  token: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  tokenAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  rpc: process.env.NEXT_PUBLIC_NEAR_MAINNET_RPC || "https://free.rpc.fastnear.com",
  explorer: "https://nearblocks.io",
  api: "https://1click.chaindefuser.com",
} as const;

export const checkoutEnabled = () => CHECKOUT.router !== "";

/** Smallest and largest checkout, in USDC units. Small enough to try, capped while it is new. */
export const CHECKOUT_MIN = 10n * CENT; // 0.10
export const CHECKOUT_MAX = 100_000n * CENT; // 1,000.00

/** Chains a payer can pay from, in the order shown, with the name people know them by. */
export const CHAINS: { id: string; name: string }[] = [
  { id: "base", name: "Base" },
  { id: "eth", name: "Ethereum" },
  { id: "arb", name: "Arbitrum" },
  { id: "op", name: "Optimism" },
  { id: "pol", name: "Polygon" },
  { id: "bsc", name: "BNB Chain" },
  { id: "avax", name: "Avalanche" },
  { id: "sol", name: "Solana" },
  { id: "tron", name: "Tron" },
  { id: "ton", name: "TON" },
  { id: "btc", name: "Bitcoin" },
];

/** Coins offered: the two big stablecoins everywhere, plus each chain's own coin where it is common. */
const COINS = new Set(["USDC", "USDT", "ETH", "SOL", "BTC", "BNB", "POL", "AVAX", "TRX", "TON"]);

export type IntentsToken = { assetId: string; decimals: number; blockchain: string; symbol: string; price?: number };
export type PayOption = { assetId: string; chain: string; chainName: string; symbol: string; decimals: number };

/** The coins a payer can choose, from 1Click's live token list. Never builds an assetId by hand. */
export function payOptions(tokens: IntentsToken[]): PayOption[] {
  const order = new Map(CHAINS.map((c, i) => [c.id, i]));
  const seen = new Set<string>();
  return tokens
    .filter((t) => order.has(t.blockchain) && COINS.has(t.symbol))
    .filter((t) => {
      const key = `${t.blockchain}:${t.symbol}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((t) => ({ assetId: t.assetId, chain: t.blockchain, chainName: CHAINS[order.get(t.blockchain)!]!.name, symbol: t.symbol, decimals: t.decimals }))
    .sort((a, b) => order.get(a.chain)! - order.get(b.chain)! || stableFirst(a.symbol) - stableFirst(b.symbol) || a.symbol.localeCompare(b.symbol));
}

const stableFirst = (s: string) => (s === "USDC" ? 0 : s === "USDT" ? 1 : 2);

/**
 * The message the router reads: pay `to` by the split version the payer saw. The ref is random
 * per checkout because every Intents delivery reaches the router from the same sender.
 */
export function checkoutMsg(ref: string, to: string, version: number): string {
  if (!ref || ref.length > MAX_REF_BYTES) throw new Error("bad ref");
  return JSON.stringify({ ref, to, version });
}

export function checkoutRef(random: () => number = Math.random): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let out = "ck-";
  for (let i = 0; i < 16; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

export type CheckoutStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";

export const isFinal = (s: string) => s === "SUCCESS" || s === "INCOMPLETE_DEPOSIT" || s === "REFUNDED" || s === "FAILED";

/** What a status means to the payer, in their words. */
export function statusText(s: string): string {
  switch (s) {
    case "PENDING_DEPOSIT":
      return "Waiting for your payment to reach the deposit address";
    case "KNOWN_DEPOSIT_TX":
      return "Your payment is on its way. Waiting for it to confirm";
    case "PROCESSING":
      return "Received. Converting it";
    case "SUCCESS":
      return "Delivered and divided";
    case "INCOMPLETE_DEPOSIT":
      return "Less than the amount asked arrived, so it is being sent back to your refund address";
    case "REFUNDED":
      return "It could not be completed, so it was sent back to your refund address";
    case "FAILED":
      return "It failed. Nothing was divided";
    default:
      return "Checking";
  }
}

export const checkoutTxUrl = (hash: string) => `${CHECKOUT.explorer}/txns/${hash}`;
