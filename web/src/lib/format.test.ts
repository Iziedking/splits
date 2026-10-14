import { describe, expect, it } from "vitest";
import type { TransferView } from "./api";
import { addUsdc, cents, greetingName, nearestCents, initials, percentToBps, sentThisMonth } from "./format";

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

describe("greetingName", () => {
  it("turns the email into a first name", () => {
    expect(greetingName("ada.obi@example.com")).toBe("Ada");
    expect(greetingName("noble+test@x.io")).toBe("Noble");
    expect(greetingName("giveaway-host@example.com")).toBe("Giveaway");
    expect(greetingName("123@example.com")).toBe("There");
  });
});

describe("cents", () => {
  it("shows vault amounts in cents, rounded down", () => {
    expect(cents("1.199999")).toBe("1.19");
    expect(cents("40.00")).toBe("40.00");
    expect(cents("12")).toBe("12.00");
    expect(cents("0.5")).toBe("0.50");
  });
});

describe("nearestCents", () => {
  it("shows a finished move to the nearest cent", () => {
    expect(nearestCents("1.199999")).toBe("1.20");
    expect(nearestCents("1.194999")).toBe("1.19");
    expect(nearestCents("1.995")).toBe("2.00");
    expect(nearestCents("40")).toBe("40.00");
    expect(nearestCents("0.004")).toBe("0.00");
  });
});
