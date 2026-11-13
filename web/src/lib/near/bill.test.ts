import { describe, expect, it } from "vitest";
import { billLeg, billPath, billProblems, billRef, decodeBill, encodeBill, equalParts, hostShare, newBillId, withTip, type Bill } from "./bill";

const U = 1_000_000n; // one USDC

const dinner: Bill = {
  id: "k3m9q2xa",
  title: "Dinner at Yellow Chilli",
  host: "ada.testnet",
  hostName: "Ada",
  total: 60n * U,
  people: [
    { name: "Bo", account: "bo.testnet", amount: 15n * U },
    { name: "Chi", account: "chi.testnet", amount: 15n * U },
    { name: "Dayo", account: "dayo.testnet", amount: 15n * U },
  ],
};

describe("dividing a bill", () => {
  it("splits equally and leaves the odd cent with the friend who paid", () => {
    expect(equalParts(60n * U, 3)).toEqual({ host: 15n * U, each: 15n * U });
    const odd = equalParts(10n * U, 2); // 10.00 between three
    expect(odd.each).toBe(3_330_000n);
    expect(odd.host).toBe(3_340_000n);
  });

  it("adds a tip in whole cents", () => {
    expect(withTip(50n * U, 10)).toBe(55n * U);
    expect(withTip(33_330_000n, 15)).toBe(38_320_000n); // 33.33 + 4.99
    expect(withTip(50n * U, 0)).toBe(50n * U);
  });

  it("knows the host's own part", () => {
    expect(hostShare(dinner)).toBe(15n * U);
  });

  it("pays each part straight to the friend who paid, with what it was for", () => {
    expect(billLeg(dinner, 1)).toEqual({ account_id: "ada.testnet", amount: "15000000", purpose: "Dinner at Yellow Chilli: Chi's part" });
  });

  it("gives every friend their own reference on this bill", () => {
    expect(billRef(dinner, 0)).toBe("bill-k3m9q2xa-1");
    expect(billRef(dinner, 2)).toBe("bill-k3m9q2xa-3");
    expect(newBillId(() => 0)).toMatch(/^[a-z2-9]{8}$/);
  });
});

describe("what is wrong with a bill", () => {
  it("says it in plain words", () => {
    const bad: Bill = { ...dinner, title: "", hostName: "", people: [{ name: "", account: "Not Valid", amount: 0n }] };
    const text = billProblems(bad).join(" ");
    expect(text).toMatch(/what the bill was for/);
    expect(text).toMatch(/your name/);
    expect(text).toMatch(/add their name/);
    expect(text).toMatch(/isn't an email or Splits account/);
    expect(text).toMatch(/at least 0.01/);
  });

  it("refuses the host on their own bill, a friend twice, and parts above the bill", () => {
    expect(billProblems({ ...dinner, people: [{ name: "Me", account: "ada.testnet", amount: U }] }).join(" ")).toMatch(/your own wallet/);
    expect(billProblems({ ...dinner, people: [dinner.people[0]!, { ...dinner.people[0]!, name: "Bo again" }] }).join(" ")).toMatch(/twice/);
    expect(billProblems({ ...dinner, total: 40n * U }).join(" ")).toMatch(/more than the bill/);
    expect(billProblems(dinner)).toEqual([]);
  });
});

describe("the bill link", () => {
  it("carries the whole bill and comes back the same", () => {
    expect(decodeBill(encodeBill(dinner))).toEqual(dinner);
    expect(billPath(dinner)).toMatch(/^\/near\/tab\?b=[A-Za-z0-9_-]+$/);
  });

  it("refuses a damaged or edited link", () => {
    expect(decodeBill(encodeBill(dinner).slice(0, -5))).toBeNull();
    expect(decodeBill("nonsense!")).toBeNull();
    expect(decodeBill(encodeBill({ ...dinner, total: 10n * U }))).toBeNull();
  });
});
