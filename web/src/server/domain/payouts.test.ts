import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { equalPot, parsePayoutLines, recipientKey } from "./payouts";

const A = "0x1111111111111111111111111111111111111111";
const B = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

describe("parsePayoutLines", () => {
  it("reads addresses, emails, amounts and labels, ignoring blank lines and CRLF", () => {
    const lines = parsePayoutLines(`${A}, 5, 1st place\r\n\r\n  Ada@Example.com ,2.50\t\nbob@example.com`);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ line: 1, target: { type: "address" }, amount: 5_000_000n, label: "1st place", problem: null });
    expect(lines[1]).toMatchObject({ line: 3, target: { type: "email", email: "ada@example.com" }, amount: 2_500_000n, label: null });
    expect(lines[2]).toMatchObject({ line: 4, target: { type: "email", email: "bob@example.com" }, amount: null });
  });

  it("explains lines it can't read", () => {
    const [bad, cents, long] = parsePayoutLines(`not-a-person\n${A}, 1.005\n${A}, 1, ${"x".repeat(32)}`);
    expect(bad!.problem).toBe("Not an email or an Arc address");
    expect(cents!.problem).toBe("Amounts must be whole cents");
    expect(long!.problem).toBe("Label is longer than 31 bytes");
  });

  it("reads tab-separated lines pasted from a spreadsheet", () => {
    expect(parsePayoutLines("ada@example.com	5	1st place")[0]).toMatchObject({
      target: { type: "email", email: "ada@example.com" },
      amount: 5_000_000n,
      label: "1st place",
      problem: null,
    });
  });

  it("refuses emails that sign-in would refuse, so nobody is paid into an account they can't open", () => {
    for (const bad of ["bob&sons@example.com", "a.@example.com", "x@y.c"]) {
      expect(parsePayoutLines(bad)[0]!.problem).toBe("That email address isn't valid");
    }
  });

  it("catches a mistyped checksummed address instead of paying it", () => {
    const good = getAddress(B); // mixed-case, with a checksum
    const i = good.search(/[a-fA-F]/);
    const flipped = good[i] === good[i]!.toUpperCase() ? good[i]!.toLowerCase() : good[i]!.toUpperCase();
    const typo = good.slice(0, i) + flipped + good.slice(i + 1);
    expect(parsePayoutLines(good)[0]!.problem).toBeNull();
    expect(parsePayoutLines(typo)[0]!.problem).toBe("This address has a typo. Copy it again from the source.");
    expect(parsePayoutLines(B.toLowerCase())[0]!.problem).toBeNull();
  });

  it("treats a trailing comma as no amount", () => {
    expect(parsePayoutLines(`${A},`)[0]).toMatchObject({ amount: null, problem: null });
  });

  it("gives case-insensitive keys so duplicates are caught", () => {
    const [x, y] = parsePayoutLines(`${B.toUpperCase().replace("0X", "0x")}\n${B}`);
    expect(recipientKey(x!.target!)).toBe(recipientKey(y!.target!));
    const [e1, e2] = parsePayoutLines("Ada@X.com\nada@x.com");
    expect(recipientKey(e1!.target!)).toBe(recipientKey(e2!.target!));
  });
});

describe("equalPot", () => {
  it("splits evenly and spreads leftover cents from the top, one each", () => {
    expect(equalPot(100_000_000n, 7)).toEqual([
      14_290_000n, 14_290_000n, 14_290_000n, 14_290_000n, 14_280_000n, 14_280_000n, 14_280_000n,
    ]);
  });

  it("always sums to the pot and never differs by more than a cent", () => {
    for (const [pot, n] of [[1_000_000n, 3], [12_340_000n, 20], [50_000n, 5], [99_990_000n, 49]] as const) {
      const parts = equalPot(pot, n);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(pot);
      const max = parts.reduce((a, b) => (b > a ? b : a));
      const min = parts.reduce((a, b) => (b < a ? b : a));
      expect(max - min <= 10_000n).toBe(true);
      expect(parts.every((p) => p % 10_000n === 0n)).toBe(true);
    }
  });

  it("refuses a pot that can't give everyone a cent", () => {
    expect(() => equalPot(40_000n, 5)).toThrow("at least one cent each");
    expect(() => equalPot(1_005_000n, 2)).toThrow("whole cents");
  });
});
