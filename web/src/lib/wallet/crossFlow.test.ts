import { describe, expect, it } from "vitest";
import { burnSent, CROSS_WALLET_TEXT, crossWalletError, markBurnSent } from "./crossFlow";
import { pickChain } from "./sourceChains";

describe("choosing the chain to pay from", () => {
  const funds = [
    { key: "eth", usdc: 50_000_000n, gas: 0n, error: false },
    { key: "op", usdc: 90_000_000n, gas: 1n, error: true },
    { key: "base", usdc: 8_200_000n, gas: 1n, error: false },
    { key: "arb", usdc: 20_000_000n, gas: 1n, error: false },
  ];
  it("picks the first chain with enough USDC and some gas", () => {
    expect(pickChain(funds, 10_151_218n)).toBe("arb");
  });
  it("picks nothing when no chain covers it", () => {
    expect(pickChain(funds, 60_000_000n)).toBeNull();
  });
});

describe("what the payer reads before anything moves", () => {
  it("says how much is missing", () => {
    expect(CROSS_WALLET_TEXT.short("8.20", "Base", "10.17")).toBe("You have $8.20 USDC on Base. This payment needs $10.17 with fees. Add USDC or pick another chain.");
  });
  it("asks for gas in the chain's token", () => {
    expect(CROSS_WALLET_TEXT.noGas("ETH", "Base")).toBe("You need a little ETH on Base for the network fee (about $0.01).");
  });
  it("maps wallet errors", () => {
    expect(crossWalletError(new Error("User rejected the request"), "Base")).toBe("You cancelled in your wallet. Nothing was sent.");
    expect(crossWalletError(new Error("chain switch refused"), "Base")).toBe("Switch your wallet to Base to continue.");
    expect(crossWalletError(new Error("approve-reverted"), "Base")).toBe("The approval didn't go through on Base. Nothing was sent. Only the network fee was spent.");
    expect(crossWalletError(new Error("burn-reverted"), "Base")).toBe("The payment didn't leave Base. Your USDC is still in your wallet. Only the network fee was spent.");
  });
});

describe("after the wallet has sent", () => {
  it("never says nothing was sent while a batched payment is still on its way", () => {
    expect(crossWalletError(new Error("bundle-pending"), "Base")).toBe(CROSS_WALLET_TEXT.bundlePending("Base"));
    expect(CROSS_WALLET_TEXT.bundlePending("Base")).not.toMatch(/Nothing was sent/);
  });

  it("remembers a sent burn so Pay isn't offered again on this device", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(burnSent(storage, "tok")).toBe(false);
    markBurnSent(storage, "tok");
    expect(burnSent(storage, "tok")).toBe(true);
    expect(burnSent(storage, "other")).toBe(false);
    expect(burnSent(null, "tok")).toBe(false);
  });
});
