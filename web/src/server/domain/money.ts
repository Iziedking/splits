import { hexToString, stringToHex, type Hex } from "viem";

/** USDC through Arc's ERC-20 interface uses 6 decimals. Native 18-decimal values never enter here. */
export const USDC_DECIMALS = 6;
const UNIT = 10n ** BigInt(USDC_DECIMALS);
const AMOUNT_PATTERN = /^(\d{1,12})(?:\.(\d{1,6}))?$/;

export class MoneyError extends Error {}

/** "12.5" -> 12_500_000n. Rejects negatives, exponents, more than 6 decimals and absurd sizes. */
export function parseUsdc(value: string): bigint {
  const match = AMOUNT_PATTERN.exec(value.trim());
  if (!match) throw new MoneyError(`"${value}" is not a USDC amount`);
  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? "").padEnd(USDC_DECIMALS, "0"));
  return whole * UNIT + fraction;
}

/** 12_500_000n -> "12.50". Keeps at least two decimals and drops trailing zeros after that. */
export function formatUsdc(amount: bigint): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / UNIT;
  let fraction = (abs % UNIT).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

const MAX_PURPOSE_BYTES = 31;

/** Purpose labels live onchain as bytes32. */
export function purposeToBytes32(label: string): Hex {
  const trimmed = label.trim();
  if (!trimmed) throw new MoneyError("A purpose label is required");
  if (new TextEncoder().encode(trimmed).length > MAX_PURPOSE_BYTES) {
    throw new MoneyError(`Keep what it's for under 32 characters ("${trimmed}" is too long)`);
  }
  return stringToHex(trimmed, { size: 32 });
}

export function bytes32ToPurpose(value: Hex): string {
  return hexToString(value, { size: 32 }).replace(/\0+$/, "");
}
