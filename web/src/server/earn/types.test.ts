import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { usdcUnits, vetVault, type EarnVault } from "./types";

const good: EarnVault = {
  address: getAddress("0xbeef0016cb2fd5c352ea7ca08a9f54739dfa7298"),
  name: "Steakhouse Prime USDC",
  apy: 0.0288,
  status: "active",
  circleGuarded: true,
  liquidity: 4_993_591_781_866n,
  asset: "USDC",
};

describe("vault vetting", () => {
  it("accepts an active, Circle-vetted USDC vault with enough liquidity", () => {
    expect(vetVault(good, usdcUnits("10000"))).toBeNull();
  });

  it("refuses a vault Circle doesn't vet, one that isn't active, a non-USDC vault, and a shallow one", () => {
    expect(vetVault({ ...good, circleGuarded: false }, 0n)).toMatch(/not vetted/);
    expect(vetVault({ ...good, status: "low_liquidity" }, 0n)).toMatch(/low_liquidity/);
    expect(vetVault({ ...good, asset: "EURC" }, 0n)).toMatch(/USDC/);
    expect(vetVault({ ...good, liquidity: usdcUnits("9999.99") }, usdcUnits("10000"))).toMatch(/liquidity/);
  });

  it("lets a testnet server use an unvetted vault, and nothing else", () => {
    expect(vetVault({ ...good, circleGuarded: false }, 0n, false)).toBeNull();
    expect(vetVault({ ...good, circleGuarded: false, status: "low_liquidity" }, 0n, false)).toMatch(/low_liquidity/);
  });

  it("reads vault amounts with any number of decimals as USDC base units", () => {
    expect(usdcUnits("4993591.781866")).toBe(4_993_591_781_866n);
    expect(usdcUnits("1.0")).toBe(1_000_000n);
    expect(usdcUnits("0.9999999")).toBe(999_999n);
    expect(usdcUnits("12")).toBe(12_000_000n);
  });
});
