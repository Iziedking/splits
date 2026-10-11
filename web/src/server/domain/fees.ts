import { CENT } from "./allocation";

/** The Splits fee: basis points, and the higher rate from `manyFrom` recipients. */
export type FeeRule = { bps: number; manyBps: number; manyFrom: number };
export type Fee = { bps: number; amount: bigint };

/** The purpose written onchain on the fee leg. */
export const FEE_PURPOSE = "splits fee";

/**
 * The Splits fee on a payment of `amount` to `recipients` people. Whole cents, because the router
 * only moves whole cents; half a cent rounds up. Paid by the sender on top of the amount.
 */
export function feeFor(amount: bigint, recipients: number, rule: FeeRule): Fee {
  const bps = recipients >= rule.manyFrom ? rule.manyBps : rule.bps;
  const perCent = 10_000n * CENT;
  return { bps, amount: ((amount * BigInt(bps) + perCent / 2n) / perCent) * CENT };
}
