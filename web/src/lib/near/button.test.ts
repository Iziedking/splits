import { describe, expect, it } from "vitest";
import { buttonProblems, buttonSnippet, buyPath, decodeButton, encodeButton, legsFor, type ButtonConfig } from "./button";
import { DEMO_SHOP } from "./demo-shop";

const shop: ButtonConfig = {
  shop: "Kofi & Co.",
  item: "House blend",
  amount: 1_000_000n,
  parts: [
    { account: "farm.testnet", bps: 7000, purpose: "supplier" },
    { account: "tax.testnet", bps: 2000, purpose: "tax" },
    { account: "tips.testnet", bps: 1000, purpose: "tips" },
  ],
};

describe("the checkout link", () => {
  it("carries the whole setup and comes back the same", () => {
    expect(decodeButton(encodeButton(shop))).toEqual(shop);
    expect(decodeButton(encodeButton({ ...shop, amount: null, item: null }))).toEqual({ ...shop, amount: null, item: null });
  });

  it("is a path on this site that only uses link-safe characters", () => {
    expect(buyPath(shop)).toMatch(/^\/near\/buy\?c=[A-Za-z0-9_-]+$/);
  });

  it("refuses a damaged or edited link instead of guessing", () => {
    const code = encodeButton(shop);
    expect(decodeButton(code.slice(0, -6))).toBeNull();
    expect(decodeButton("not base64 at all!")).toBeNull();
    expect(decodeButton(encodeButton({ ...shop, parts: [{ ...shop.parts[0]!, bps: 9000 }, ...shop.parts.slice(1)] }))).toBeNull();
  });

  it("keeps the demo shop usable", () => {
    expect(buttonProblems(DEMO_SHOP)).toEqual([]);
    expect(decodeButton(encodeButton(DEMO_SHOP))).toEqual(DEMO_SHOP);
  });
});

describe("a sale divides", () => {
  it("exactly, by the router's own rounding", () => {
    const legs = legsFor(shop, 1_000_000n);
    expect(legs.map((l) => l.amount)).toEqual(["700000", "200000", "100000"]);
    expect(legs.map((l) => l.purpose)).toEqual(["supplier", "tax", "tips"]);
    const odd = legsFor(shop, 333_333n);
    expect(odd.reduce((a, l) => a + BigInt(l.amount), 0n)).toBe(333_333n);
  });

  it("says what is wrong with a setup in plain words", () => {
    const bad: ButtonConfig = { shop: "", item: null, amount: 0n, parts: [{ account: "Not An Account", bps: 5000, purpose: "" }] };
    const problems = buttonProblems(bad).join(" ");
    expect(problems).toMatch(/name/);
    expect(problems).toMatch(/price/);
    expect(problems).toMatch(/not a NEAR account/);
    expect(problems).toMatch(/what it is for/);
    expect(problems).toMatch(/add up to 50%/);
  });

  it("refuses a price too small to give every part something", () => {
    expect(buttonProblems({ ...shop, amount: 1n })).not.toEqual([]);
  });
});

describe("the snippet", () => {
  it("is a plain link that escapes what it writes", () => {
    const html = buttonSnippet('https://x.test/near/buy?c=a"><script>', "Pay <now>");
    expect(html.startsWith("<a href=")).toBe(true);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
    expect(html).toContain("Pay &lt;now&gt;");
    expect(html).toContain('target="_blank"');
    expect(buttonSnippet("https://x.test", "Pay", false)).not.toContain("target=");
  });
});
