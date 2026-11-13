import { describe, expect, it } from "vitest";
import { publicPurpose } from "./recent";

describe("Divided just now shows no one", () => {
  it("drops the name from a bill part", () => {
    expect(publicPurpose("Lunch check: Me's part")).toBe("Lunch check, bill share");
    expect(publicPurpose("Dinner at Yellow Chilli: Bo's part")).toBe("Dinner at Yellow Chilli, bill share");
  });
  it("hides emails and account names", () => {
    expect(publicPurpose("rent for ada@example.com")).toBe("a payment");
    expect(publicPurpose("paid to mum.kingizie.testnet")).toBe("a payment");
  });
  it("keeps ordinary purposes", () => {
    expect(publicPurpose("Tax")).toBe("Tax");
    expect(publicPurpose("sales tax pot")).toBe("sales tax pot");
  });
});
