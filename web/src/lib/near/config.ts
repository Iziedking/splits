/**
 * NEAR mode settings. NEAR mode serves near.mysplits.xyz; mysplits.xyz (Arc) never shows it.
 * NEXT_PUBLIC_* values are inlined at build time, so the testnet defaults below are what a build
 * without them uses. Every value was checked on chain on 2026-11-12.
 */
export type NearNetwork = "testnet" | "mainnet";

const network: NearNetwork = process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const NEAR = {
  network,
  /** The splits-router contract (near/splits-router). No owner methods. */
  router: process.env.NEXT_PUBLIC_NEAR_ROUTER || "splits.kingizie.testnet",
  /** Circle's USDC on NEAR testnet, from developers.circle.com, 6 decimals. */
  token: process.env.NEXT_PUBLIC_NEAR_TOKEN || "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
  tokenSymbol: "USDC",
  tokenDecimals: 6,
  // rpc.*.near.org answers 429 with a deprecation notice; FastNEAR is listed at docs.near.org/api/rpc/providers.
  rpc: process.env.NEXT_PUBLIC_NEAR_RPC || (network === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com"),
  explorer: network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io",
  /** Where people get testnet USDC. */
  faucet: "https://faucet.circle.com",
  /** Where people get testnet NEAR for gas. */
  nearFaucet: "https://near-faucet.io",
  /** Sputnik DAO v2 factory. Testnet checked 2026-11-12 (5,600 DAOs, contract 3.31); the mainnet name is not checked yet. */
  daoFactory: process.env.NEXT_PUBLIC_NEAR_DAO_FACTORY || (network === "mainnet" ? "sputnik-dao.near" : "sputnikv2.testnet"),
} as const;

/** Server side: NEAR pages and APIs exist only where NEAR_ENABLED=1 (the near.mysplits.xyz deploy). */
export function nearEnabled(): boolean {
  return process.env.NEAR_ENABLED === "1";
}

/** Hosts that open straight into NEAR mode, e.g. "near.mysplits.xyz". */
export function nearHosts(): string[] {
  return (process.env.NEAR_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function txUrl(hash: string): string {
  return `${NEAR.explorer}/txns/${hash}`;
}

export function accountUrl(id: string): string {
  return `${NEAR.explorer}/address/${id}`;
}
