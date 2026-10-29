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

/**
 * The contract's rules for a split. `partialShares` allows percentages that total less than 100%
 * (whatever isn't allocated isn't sent): fine for splits the app pays as a list of exact amounts,
 * never for one registered on the contract, which needs exactly 100%.
 */
export function validateLegs(legs: readonly LegRule[], forbidden: readonly Address[], opts: { partialShares?: boolean } = {}): void {
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
      throw new SplitRuleError("FIXED_AMOUNT_NOT_CENTS", "Use whole cents, like 25.50", i);
    }
    totalBps += leg.shareBps;
  });
  const sharesOk = totalBps === 0 || totalBps === BPS_DENOMINATOR || (opts.partialShares === true && totalBps < BPS_DENOMINATOR);
  if (!sharesOk) {
    throw new SplitRuleError("SHARES_MUST_TOTAL", `Percentages add up to ${totalBps / 100}%, not 100%`);
  }
}

/**
 * Fixed legs first, then shares of the rest, each rounded down to a whole cent. When the shares
 * total 100%, the last share leg takes the leftover cents (as the contract does). Under 100%, each
 * gets exactly its percentage and the rest isn't sent. Every amount comes out in whole cents.
 */
export function allocate(legs: readonly Pick<LegRule, "fixedAmount" | "shareBps">[], amount: bigint): bigint[] {
  if (amount <= 0n) throw new SplitRuleError("ZERO_AMOUNT", "Amount must be more than zero");
  if (amount % CENT !== 0n) throw new SplitRuleError("AMOUNT_NOT_CENTS", "Use whole cents, like 25.50");

  let fixedTotal = 0n;
  let lastShare = -1;
  let totalBps = 0;
  legs.forEach((leg, i) => {
    if (leg.fixedAmount !== 0n) fixedTotal += leg.fixedAmount;
    else lastShare = i;
    totalBps += leg.shareBps;
  });
  const whole = totalBps === BPS_DENOMINATOR;

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
    if (i === lastShare && whole) return remainder - shared;
    const part = ((remainder * BigInt(leg.shareBps)) / BigInt(BPS_DENOMINATOR) / CENT) * CENT;
    shared += part;
    return part;
  });
}

export function normaliseAddress(value: string): Address {
  return getAddress(value);
}
