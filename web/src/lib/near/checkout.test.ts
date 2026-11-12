import { describe, expect, it } from "vitest";
import { checkoutMsg, checkoutRef, isFinal, payOptions, statusText, type IntentsToken } from "./checkout";

const t = (blockchain: string, symbol: string, assetId = `nep141:${blockchain}-${symbol}.omft.near`): IntentsToken => ({ assetId, blockchain, symbol, decimals: 6 });

describe("payOptions", () => {
  it("offers the known coins on the known chains, stablecoins first, in chain order", () => {
    const options = payOptions([t("sol", "SOL"), t("base", "ETH"), t("sol", "USDC"), t("base", "USDC"), t("near", "USDC"), t("base", "PEPE"), t("zec", "ZEC")]);
    expect(options.map((o) => `${o.chainName}:${o.symbol}`)).toEqual(["Base:USDC", "Base:ETH", "Solana:USDC", "Solana:SOL"]);
  });

  it("keeps the assetId 1Click gave, and one entry per coin and chain", () => {
    const options = payOptions([t("base", "USDC", "nep141:first"), t("base", "USDC", "nep141:second")]);
    expect(options).toHaveLength(1);
    expect(options[0]!.assetId).toBe("nep141:first");
  });

  it("never offers NEAR itself: a NEAR payer uses the normal pay link", () => {
    expect(payOptions([t("near", "USDC"), t("near", "USDT")])).toEqual([]);
  });
});

describe("the router message", () => {
  it("names the recipient and the split version the payer saw", () => {
    expect(JSON.parse(checkoutMsg("ck-abc", "ada.near", 3))).toEqual({ ref: "ck-abc", to: "ada.near", version: 3 });
  });

  it("refuses a reference the router would refuse", () => {
    expect(() => checkoutMsg("", "ada.near", 1)).toThrow();
    expect(() => checkoutMsg("x".repeat(65), "ada.near", 1)).toThrow();
  });

  it("makes a long random reference, because every delivery comes from the same sender", () => {
    const a = checkoutRef();
    expect(a).toMatch(/^ck-[a-z2-9]{16}$/);
    expect(checkoutRef()).not.toBe(a);
  });
});

describe("status", () => {
  it("knows which states are final", () => {
    expect(["SUCCESS", "REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"].every(isFinal)).toBe(true);
    expect(["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING"].some(isFinal)).toBe(false);
  });

  it("says what each one means without jargon", () => {
    expect(statusText("SUCCESS")).toMatch(/divided/);
    expect(statusText("REFUNDED")).toMatch(/refund address/);
  });
});
