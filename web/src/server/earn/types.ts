import type { Address } from "viem";

/** The one vault an Earning pocket uses, as Earn Kit describes it. */
export type EarnVault = {
  address: Address;
  name: string;
  /** 0.0288 is 2.88% a year, variable. */
  apy: number;
  status: string;
  circleGuarded: boolean;
  /** USDC that can be withdrawn right now, in base units. */
  liquidity: bigint;
  asset: string;
};

/** What a wallet holds in the vault, in USDC base units. `principal` is null when Earn Kit can't say. */
export type EarnPosition = { assets: bigint; principal: bigint | null };

/**
 * Deposits into and withdraws from the pinned vault for a Splits wallet. Live: Arc Earn Kit over
 * Circle developer-controlled wallets. Preview: an in-memory vault in PreviewArc.
 */
export interface EarnProvider {
  vault(): Promise<EarnVault>;
  position(owner: Address): Promise<EarnPosition>;
  deposit(owner: Address, amount: bigint): Promise<{ txHash: string }>;
  withdraw(owner: Address, amount: bigint): Promise<{ txHash: string }>;
}

/**
 * Splits only offers a USDC vault that is open, vetted by Circle, and deep enough to withdraw from.
 * `requireVetted` may be false on Arc Testnet only, where no vault is vetted (config refuses it on mainnet).
 */
export function vetVault(v: EarnVault, minLiquidity: bigint, requireVetted = true): string | null {
  if (v.asset !== "USDC") return `holds ${v.asset}, not USDC`;
  if (v.status !== "active") return `status is ${v.status}`;
  if (requireVetted && !v.circleGuarded) return "not vetted by Circle";
  if (v.liquidity < minLiquidity) return "not enough liquidity to withdraw from";
  return null;
}

/** "4993591.781866" or "0.9999999" -> USDC base units, extra decimals dropped (never rounded up). */
export function usdcUnits(s: string): bigint {
  const [whole = "0", fraction = ""] = s.trim().split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt(fraction.slice(0, 6).padEnd(6, "0"));
}
