import { describe, expect, it } from "vitest";
import { colourFor, initials } from "./avatar";

describe("initials", () => {
  it("takes two letters from an email", () => {
    expect(initials("lawfuldlaw@gmail.com")).toBe("LA");
    expect(initials("ada.lovelace@example.com")).toBe("AL");
    expect(initials("j@x.io")).toBe("J");
  });
  it("takes two letters from an account", () => {
    expect(initials("kingizie.testnet")).toBe("KI");
    expect(initials("u-3f9c2e1a7b.splits-app.testnet")).toBe("U3");
  });
});

describe("colourFor", () => {
  it("gives the same person the same colour, and different people varied colours", () => {
    expect(colourFor("ada@example.com")).toBe(colourFor("ADA@example.com"));
    const seen = new Set(["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com", "f@x.com"].map(colourFor));
    expect(seen.size).toBeGreaterThan(2);
  });
});
