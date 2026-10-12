import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { allocate, SplitRuleError, validateLegs } from "./allocation";
import { quote } from "./fx";
import { deterministicUuid, transferRef } from "./ids";
import { bytes32ToPurpose, formatUsdc, parseUsdc, purposeToBytes32 } from "./money";

const A = getAddress("0x00000000000000000000000000000000000000a1");
const B = getAddress("0x00000000000000000000000000000000000000b2");
const C = getAddress("0x00000000000000000000000000000000000000c3");
const share = (bps: number) => ({ fixedAmount: 0n, shareBps: bps });
const fixed = (amount: bigint) => ({ fixedAmount: amount, shareBps: 0 });

describe("money", () => {
  it("parses and formats USDC with 6 decimals", () => {
    expect(parseUsdc("12.5")).toBe(12_500_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(formatUsdc(12_500_000n)).toBe("12.50");
    expect(formatUsdc(1n)).toBe("0.000001");
    expect(formatUsdc(333_401n)).toBe("0.333401");
  });

  it("refuses amounts that are not plain USDC", () => {
    for (const bad of ["-1", "1e6", "1.0000001", "abc", "", " ", "1,000", "0x10"]) {
      expect(() => parseUsdc(bad), bad).toThrow();
    }
  });

  it("round-trips purpose labels through bytes32 and caps their length", () => {
    expect(bytes32ToPurpose(purposeToBytes32("school fees"))).toBe("school fees");
    expect(() => purposeToBytes32("x".repeat(32))).toThrow(/too long/);
    expect(() => purposeToBytes32("  ")).toThrow();
  });
});

describe("allocation mirrors SplitsRouter", () => {
  // Same vectors as contracts/test/SplitsRouter.t.sol.
  it("splits 40/35/25", () => {
    expect(allocate([share(4000), share(3500), share(2500)], 500_000_000n)).toEqual([
      200_000_000n,
      175_000_000n,
      125_000_000n,
    ]);
  });

  it("rounds shares down to whole cents and gives the leftover to the last share leg", () => {
    expect(allocate([share(3333), share(3333), share(3334)], 1_000_000n)).toEqual([330_000n, 330_000n, 340_000n]);
    // $12.70 at 40/35/25: 35% would be $4.445.
    expect(allocate([share(4000), share(3500), share(2500)], 12_700_000n)).toEqual([5_080_000n, 4_440_000n, 3_180_000n]);
  });

  it("refuses amounts and fixed legs that aren't whole cents", () => {
    expect(() => allocate([share(10_000)], 1_000_001n)).toThrow(/whole cents/);
    expect(() => validateLegs([{ recipient: A, ...fixed(1_000_001n) }], [])).toThrow(/whole cents/);
  });

  it("pays fixed legs first, then shares the rest", () => {
    expect(allocate([fixed(300_000_000n), fixed(150_000_000n), share(10_000)], 500_000_000n)).toEqual([
      300_000_000n,
      150_000_000n,
      50_000_000n,
    ]);
  });

  it("needs exactly the fixed total when there are no share legs", () => {
    const legs = [fixed(1_000_000n), fixed(500_000n)];
    expect(allocate(legs, 1_500_000n)).toEqual([1_000_000n, 500_000n]);
    expect(() => allocate(legs, 1_510_000n)).toThrow(SplitRuleError);
    expect(() => allocate(legs, 1_490_000n)).toThrow(SplitRuleError);
  });

  it("always conserves the amount", () => {
    for (let i = 0; i < 2000; i++) {
      const a = 1 + Math.floor(Math.random() * 9998);
      const b = 1 + Math.floor(Math.random() * (9999 - a));
      const amount = (1n + BigInt(Math.floor(Math.random() * 1e8))) * 10_000n;
      const out = allocate([share(a), share(b), share(10_000 - a - b)], amount);
      expect(out.reduce((s, x) => s + x, 0n)).toBe(amount);
      for (const part of out) expect(part % 10_000n).toBe(0n);
    }
  });

  it("validates legs like the contract", () => {
    const ok = [
      { recipient: A, ...share(5000) },
      { recipient: B, ...share(5000) },
    ];
    expect(() => validateLegs(ok, [C])).not.toThrow();
    expect(() => validateLegs([], [])).toThrow(/at least one/);
    expect(() => validateLegs([{ recipient: C, ...share(10_000) }], [C])).toThrow(/can't receive/);
    expect(() => validateLegs([{ recipient: A, fixedAmount: 5n, shareBps: 10_000 }], [])).toThrow(SplitRuleError);
    expect(() => validateLegs([{ recipient: A, ...share(9999) }], [])).toThrow(/99.99%/);
    // Like the router, the mirror has no recipient limit; the app's limit is MAX_PAYOUT_RECIPIENTS.
    expect(() =>
      validateLegs(
        Array.from({ length: 250 }, () => ({ recipient: A, ...fixed(10_000n) })),
        [],
      ),
    ).not.toThrow();
  });
});

describe("splits whose shares total under 100%", () => {
  it("are allowed for sending when asked for, never above 100% and never for the contract's own splits", () => {
    const partial = [
      { recipient: A, ...share(3000) },
      { recipient: B, ...share(2000) },
    ];
    expect(() => validateLegs(partial, [], { partialShares: true })).not.toThrow();
    expect(() => validateLegs(partial, [])).toThrow(/50%/);
    expect(() => validateLegs([{ recipient: A, ...share(6000) }, { recipient: B, ...share(5000) }], [], { partialShares: true })).toThrow(/110%/);
  });

  it("give each person exactly their percentage, rounded down to the cent; the rest isn't sent", () => {
    expect(allocate([share(3000), share(2000)], 100_000_000n)).toEqual([30_000_000n, 20_000_000n]);
    // Nobody is handed the cents left over from rounding: they stay unsent.
    expect(allocate([share(3333), share(3333)], 1_000_000n)).toEqual([330_000n, 330_000n]);
    expect(allocate([fixed(10_000_000n), share(5000)], 30_000_000n)).toEqual([10_000_000n, 10_000_000n]);
  });
});

describe("fx quote (simulated)", () => {
  const rates = { GBP: 1_270_000n, EUR: 1_090_000n, USD: 1_000_000n };
  it("converts pence to USDC and rounds down to whole cents", () => {
    expect(quote("GBP", 10_000, rates).usdcAmount).toBe(127_000_000n);
    expect(quote("GBP", 1, rates).usdcAmount).toBe(10_000n); // 1.27 cents -> 1 cent
    expect(quote("GBP", 1250, rates).usdcAmount).toBe(15_870_000n); // $15.875 -> $15.87
    expect(quote("GBP", 10_000, rates).simulated).toBe(true);
  });
  it("refuses zero, negative and oversized amounts", () => {
    expect(() => quote("GBP", 0, rates)).toThrow();
    expect(() => quote("GBP", -5, rates)).toThrow();
    expect(() => quote("GBP", 1.5, rates)).toThrow();
    expect(() => quote("GBP", 1_000_001, rates)).toThrow();
  });
});

describe("ids", () => {
  it("derives stable v4-shaped idempotency keys", () => {
    const key = deterministicUuid("t1:send:1");
    expect(key).toBe(deterministicUuid("t1:send:1"));
    expect(key).not.toBe(deterministicUuid("t1:send:2"));
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("derives a distinct bytes32 ref per transfer", () => {
    expect(transferRef("a")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(transferRef("a")).not.toBe(transferRef("b"));
  });
});
