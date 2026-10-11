import { describe, expect, it } from "vitest";
import type { TransferView } from "./api";
import { addUsdc, initials, percentToBps, sentThisMonth } from "./format";

describe("client formatting", () => {
  it("makes initials from names", () => {
    expect(initials("Landlord")).toBe("LA");
    expect(initials("  mama   ngozi ")).toBe("MN");
    expect(initials("")).toBe("?");
  });

  it("adds USDC strings exactly", () => {
    expect(addUsdc(["5.08", "4.445", "3.175"])).toBe("12.70");
    expect(addUsdc(["0.1", "0.2"])).toBe("0.30");
    expect(addUsdc([])).toBe("0.00");
  });

  it("totals only this month's settled payments for one split", () => {
    const t = (over: Partial<TransferView>) =>
      ({ splitId: "s1", status: "settled", amount: "10.00", createdAt: "2026-10-05T10:00:00.000Z", ...over }) as TransferView;
    const list = [t({}), t({ amount: "2.50" }), t({ status: "failed" }), t({ splitId: "s2" }), t({ createdAt: "2026-09-30T23:00:00.000Z" })];
    expect(sentThisMonth(list, "s1", new Date("2026-10-12T00:00:00Z"))).toBe("12.50");
  });

  it("reads percentages people type", () => {
    expect(percentToBps("40")).toBe(4000);
    expect(percentToBps("33.33")).toBe(3333);
    expect(percentToBps("0")).toBeNull();
    expect(percentToBps("101")).toBeNull();
    expect(percentToBps("33.333")).toBeNull();
    expect(percentToBps("abc")).toBeNull();
  });
});
