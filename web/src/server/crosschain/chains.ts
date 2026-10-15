import type { Address } from "viem";

/**
 * The chains a deposit can arrive on, each moved to Arc with CCTP V2. Domains and USDC addresses
 * are from Circle's published tables (checked 2026-10-12); Base, Arbitrum and Optimism were also
 * checked on chain (USDC symbol, CCTP localDomain). A chain is offered only when it is listed in
 * DEPOSIT_CHAINS, and startup refuses one whose CCTP contracts don't answer with its domain.
 */
export type ChainKey = "eth" | "avax" | "op" | "arb" | "base" | "matic" | "uni" | "monad";
export type CrossNetwork = "mainnet" | "testnet";
type PerNet<T> = Record<CrossNetwork, T>;

export type SourceChain = {
  key: ChainKey;
  name: string;
  /** Circle developer-controlled wallets blockchain code. */
  circle: PerNet<string>;
  /** CCTP domain id (the same on mainnet and testnet). */
  domain: number;
  usdc: PerNet<Address>;
  /** Fast Transfer is offered (and worth it) from this chain. */
  fast: boolean;
  /** Below this a deposit waits on the chain: moving it would cost more than it carries. */
  minUnits: bigint;
  rpc: PerNet<string>;
  explorer: PerNet<string>;
  /** EVM chain id, checked against the RPC at startup. */
  chainId: PerNet<number>;
  /** The token the chain's network fee is paid in. */
  gas: string;
};

export const ARC_DOMAIN = 26;

/** CCTP V2 contracts: one address pair on every EVM chain of a network, Arc included. */
export const CCTP: PerNet<{ tokenMessenger: Address; messageTransmitter: Address }> = {
  mainnet: { tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d", messageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" },
  testnet: { tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA", messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" },
};

const DOLLAR = 1_000_000n;

export const SOURCE_CHAINS: Record<ChainKey, SourceChain> = {
  base: {
    key: "base",
    name: "Base",
    circle: { mainnet: "BASE", testnet: "BASE-SEPOLIA" },
    domain: 6,
    usdc: { mainnet: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", testnet: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
    fast: true,
    minUnits: DOLLAR,
    rpc: { mainnet: "https://mainnet.base.org", testnet: "https://sepolia.base.org" },
    explorer: { mainnet: "https://basescan.org", testnet: "https://sepolia.basescan.org" },
    chainId: { mainnet: 8453, testnet: 84532 },
    gas: "ETH",
  },
  arb: {
    key: "arb",
    name: "Arbitrum",
    circle: { mainnet: "ARB", testnet: "ARB-SEPOLIA" },
    domain: 3,
    usdc: { mainnet: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", testnet: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" },
    fast: true,
    minUnits: DOLLAR,
    rpc: { mainnet: "https://arb1.arbitrum.io/rpc", testnet: "https://sepolia-rollup.arbitrum.io/rpc" },
    explorer: { mainnet: "https://arbiscan.io", testnet: "https://sepolia.arbiscan.io" },
    chainId: { mainnet: 42161, testnet: 421614 },
    gas: "ETH",
  },
  op: {
    key: "op",
    name: "Optimism",
    circle: { mainnet: "OP", testnet: "OP-SEPOLIA" },
    domain: 2,
    usdc: { mainnet: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", testnet: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7" },
    fast: true,
    minUnits: DOLLAR,
    rpc: { mainnet: "https://mainnet.optimism.io", testnet: "https://sepolia.optimism.io" },
    explorer: { mainnet: "https://optimistic.etherscan.io", testnet: "https://sepolia-optimism.etherscan.io" },
    chainId: { mainnet: 10, testnet: 11155420 },
    gas: "ETH",
  },
  matic: {
    key: "matic",
    name: "Polygon",
    circle: { mainnet: "MATIC", testnet: "MATIC-AMOY" },
    domain: 7,
    usdc: { mainnet: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", testnet: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582" },
    fast: false,
    minUnits: DOLLAR,
    rpc: { mainnet: "https://polygon-bor-rpc.publicnode.com", testnet: "https://polygon-amoy-bor-rpc.publicnode.com" },
    explorer: { mainnet: "https://polygonscan.com", testnet: "https://amoy.polygonscan.com" },
    chainId: { mainnet: 137, testnet: 80002 },
    gas: "POL",
  },
  avax: {
    key: "avax",
    name: "Avalanche",
    circle: { mainnet: "AVAX", testnet: "AVAX-FUJI" },
    domain: 1,
    usdc: { mainnet: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", testnet: "0x5425890298aed601595a70AB815c96711a31Bc65" },
    fast: false,
    minUnits: DOLLAR,
    rpc: { mainnet: "https://api.avax.network/ext/bc/C/rpc", testnet: "https://api.avax-test.network/ext/bc/C/rpc" },
    explorer: { mainnet: "https://snowtrace.io", testnet: "https://testnet.snowtrace.io" },
    chainId: { mainnet: 43114, testnet: 43113 },
    gas: "AVAX",
  },
  uni: {
    key: "uni",
    name: "Unichain",
    circle: { mainnet: "UNI", testnet: "UNI-SEPOLIA" },
    domain: 10,
    usdc: { mainnet: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", testnet: "0x31d0220469e10c4E71834a79b1f276d740d3768F" },
    fast: true,
    minUnits: DOLLAR,
    rpc: { mainnet: "https://mainnet.unichain.org", testnet: "https://sepolia.unichain.org" },
    explorer: { mainnet: "https://uniscan.xyz", testnet: "https://sepolia.uniscan.xyz" },
    chainId: { mainnet: 130, testnet: 1301 },
    gas: "ETH",
  },
  monad: {
    key: "monad",
    name: "Monad",
    circle: { mainnet: "MONAD", testnet: "MONAD-TESTNET" },
    domain: 15,
    usdc: { mainnet: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", testnet: "0x534b2f3A21130d7a60830c2Df862319e593943A3" },
    fast: false,
    minUnits: DOLLAR,
    rpc: { mainnet: "https://rpc.monad.xyz", testnet: "https://testnet-rpc.monad.xyz" },
    explorer: { mainnet: "https://monadvision.com", testnet: "https://testnet.monadexplorer.com" },
    chainId: { mainnet: 143, testnet: 10143 },
    gas: "MON",
  },
  eth: {
    key: "eth",
    name: "Ethereum",
    circle: { mainnet: "ETH", testnet: "ETH-SEPOLIA" },
    domain: 0,
    usdc: { mainnet: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", testnet: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" },
    fast: true,
    // Gas on Ethereum runs to dollars per move.
    minUnits: 20n * DOLLAR,
    rpc: { mainnet: "https://ethereum-rpc.publicnode.com", testnet: "https://ethereum-sepolia-rpc.publicnode.com" },
    explorer: { mainnet: "https://etherscan.io", testnet: "https://sepolia.etherscan.io" },
    chainId: { mainnet: 1, testnet: 11155111 },
    gas: "ETH",
  },
};

/** The chains named in DEPOSIT_CHAINS, in that order. A name that isn't a chain stops startup. */
export function enabledChains(keys: string[]): SourceChain[] {
  return keys.map((k) => {
    const chain = SOURCE_CHAINS[k as ChainKey];
    if (!chain) throw new Error(`DEPOSIT_CHAINS: "${k}" is not a deposit chain (${Object.keys(SOURCE_CHAINS).join(", ")})`);
    return chain;
  });
}

export function chainByCircleCode(code: string): { chain: SourceChain; network: CrossNetwork } | null {
  for (const chain of Object.values(SOURCE_CHAINS)) {
    if (chain.circle.mainnet === code) return { chain, network: "mainnet" };
    if (chain.circle.testnet === code) return { chain, network: "testnet" };
  }
  return null;
}

/** The chains named in CROSS_PAY_CHAINS, in that order. A name that isn't an EVM chain stops startup. */
export function crossPayChains(keys: string[]): SourceChain[] {
  return keys.map((k) => {
    const chain = SOURCE_CHAINS[k as ChainKey];
    if (!chain) throw new Error(`CROSS_PAY_CHAINS: "${k}" is not an EVM chain (${Object.keys(SOURCE_CHAINS).join(", ")})`);
    return chain;
  });
}
