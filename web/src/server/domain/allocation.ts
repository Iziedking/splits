import { getAddress, isAddress, zeroAddress, type Address } from "viem";

/**
 * Mirror of SplitsRouter._validate and SplitsRouter._allocate. The app uses it to show exact
 * amounts before a payment and to check the onchain receipt after one. Any change here must match
 * contracts/src/SplitsRouter.sol; allocation.test.ts pins the shared vectors.
 */

export const BPS_DENOMINATOR = 10_000;
/** One cent in USDC base units. The router works in whole cents. */
export const CENT = 10_000n;
const MAX_UINT96 = (1n << 96n) - 1n;

export type LegRule = {
  recipient: Address;
  fixedAmount: bigint;
  shareBps: number;
};

export type SplitRuleCode =
  | "NO_LEGS"
  | "INVALID_RECIPIENT"
  | "LEG_NEEDS_EXACTLY_ONE_RULE"
  | "SHARES_MUST_TOTAL"
  | "ZERO_AMOUNT"
  | "AMOUNT_BELOW_FIXED"
  | "AMOUNT_MUST_EQUAL_FIXED"
  | "FIXED_AMOUNT_NOT_CENTS"
  | "AMOUNT_NOT_CENTS";

export class SplitRuleError extends Error {
  constructor(
    readonly code: SplitRuleCode,
    message: string,
    readonly index?: number,
  ) {
    super(message);
  }
}

export function validateLegs(legs: readonly LegRule[], forbidden: readonly Address[]): void {
  if (legs.length === 0) throw new SplitRuleError("NO_LEGS", "Add at least one recipient");
  const blocked = new Set([zeroAddress, ...forbidden].map((a) => a.toLowerCase()));
  let totalBps = 0;
  legs.forEach((leg, i) => {
    if (!isAddress(leg.recipient) || blocked.has(leg.recipient.toLowerCase())) {
      throw new SplitRuleError("INVALID_RECIPIENT", "This recipient can't receive payments", i);
    }
    if (!Number.isInteger(leg.shareBps) || leg.shareBps < 0 || leg.shareBps > 0xffff) {
      throw new SplitRuleError("LEG_NEEDS_EXACTLY_ONE_RULE", "Percentage is out of range", i);
    }
    if (leg.fixedAmount < 0n || leg.fixedAmount > MAX_UINT96) {
      throw new SplitRuleError("LEG_NEEDS_EXACTLY_ONE_RULE", "Fixed amount is out of range", i);
    }
    const hasFixed = leg.fixedAmount !== 0n;
    const hasShare = leg.shareBps !== 0;
    if (hasFixed === hasShare) {
      throw new SplitRuleError("LEG_NEEDS_EXACTLY_ONE_RULE", "Give each recipient a fixed amount or a percentage", i);
    }
    if (leg.fixedAmount % CENT !== 0n) {
      throw new SplitRuleError("FIXED_AMOUNT_NOT_CENTS", "Fixed amounts must be whole cents", i);
    }
    totalBps += leg.shareBps;
  });
  if (totalBps !== 0 && totalBps !== BPS_DENOMINATOR) {
    throw new SplitRuleError("SHARES_MUST_TOTAL", `Percentages add up to ${totalBps / 100}%, not 100%`);
  }
}

/**
 * Fixed legs first, then shares of the rest, each rounded down to a whole cent; the last share leg
 * takes the leftover cents. Every amount comes out in whole cents.
 */
export function allocate(legs: readonly Pick<LegRule, "fixedAmount" | "shareBps">[], amount: bigint): bigint[] {
  if (amount <= 0n) throw new SplitRuleError("ZERO_AMOUNT", "Amount must be more than zero");
  if (amount % CENT !== 0n) throw new SplitRuleError("AMOUNT_NOT_CENTS", "Amounts must be whole cents");

  let fixedTotal = 0n;
  let lastShare = -1;
  legs.forEach((leg, i) => {
    if (leg.fixedAmount !== 0n) fixedTotal += leg.fixedAmount;
    else lastShare = i;
  });

  if (amount < fixedTotal) {
    throw new SplitRuleError("AMOUNT_BELOW_FIXED", "Amount is less than the fixed payments in this split");
  }
  const remainder = amount - fixedTotal;
  if (lastShare === -1 && remainder !== 0n) {
    throw new SplitRuleError("AMOUNT_MUST_EQUAL_FIXED", "This split only has fixed amounts; send exactly their total");
  }

  let shared = 0n;
  return legs.map((leg, i) => {
    if (leg.fixedAmount !== 0n) return leg.fixedAmount;
    if (i === lastShare) return remainder - shared;
    const part = ((remainder * BigInt(leg.shareBps)) / BigInt(BPS_DENOMINATOR) / CENT) * CENT;
    shared += part;
    return part;
  });
}

export function normaliseAddress(value: string): Address {
  return getAddress(value);
}
