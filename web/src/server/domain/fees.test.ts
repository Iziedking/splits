import { describe, expect, it } from "vitest";
import { feeFor } from "./fees";

const rule = { bps: 150, manyBps: 200, manyFrom: 10 };
const usdc = (n: number) => BigInt(Math.round(n * 1_000_000));

describe("Splits fee", () => {
  it("is the rate on the amount, in whole cents, rounded half up", () => {
    expect(feeFor(usdc(100), 3, rule)).toEqual({ bps: 150, amount: usdc(1.5) });
    expect(feeFor(usdc(9), 3, rule)).toEqual({ bps: 150, amount: usdc(0.14) }); // 13.5 cents rounds up
    expect(feeFor(usdc(0.3), 1, rule)).toEqual({ bps: 150, amount: 0n }); // 0.45 cents rounds down
    expect(feeFor(usdc(1), 1, rule).amount % 10_000n).toBe(0n);
  });

  it("uses the many-people rate from the cutoff", () => {
    expect(feeFor(usdc(10), 9, rule).bps).toBe(150);
    expect(feeFor(usdc(10), 10, rule).bps).toBe(200);
    expect(feeFor(usdc(10), 11, rule)).toEqual({ bps: 200, amount: usdc(0.2) });
  });

  it("is zero when fees are off", () => {
    expect(feeFor(usdc(500), 50, { bps: 0, manyBps: 0, manyFrom: 10 })).toEqual({ bps: 0, amount: 0n });
  });
});
