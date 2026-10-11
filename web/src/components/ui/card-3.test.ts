import { describe, expect, it } from "vitest";
import { formatAmount } from "./card-3";

describe("formatAmount", () => {
  it("formats exact decimal strings without float rounding", () => {
    expect(formatAmount("12.70")).toBe("12.70");
    expect(formatAmount("4.445")).toBe("4.445");
    expect(formatAmount("1234567.5")).toBe("1,234,567.50");
    expect(formatAmount("0")).toBe("0.00");
  });

  it("keeps the reference behaviour for numbers", () => {
    expect(formatAmount(486.32)).toBe("486.32");
    expect(formatAmount(1000)).toBe("1,000.00");
  });
});
