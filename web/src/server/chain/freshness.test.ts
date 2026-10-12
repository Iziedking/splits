import { describe, expect, it } from "vitest";
import { freshOrder } from "./freshness";

const urls = ["https://own-node", "https://public-a", "https://public-b"];

describe("choosing an Arc RPC that is up to date", () => {
  it("keeps the configured order while every RPC is current", () => {
    expect(freshOrder(urls, [1000, 1001, 999])).toEqual(urls);
  });

  it("moves a node that has fallen behind to the back, so balances are never old", () => {
    expect(freshOrder(urls, [900, 1000, 1000])).toEqual(["https://public-a", "https://public-b", "https://own-node"]);
  });

  it("treats an RPC that didn't answer as behind", () => {
    expect(freshOrder(urls, [null, 1000, 990])).toEqual(["https://public-a", "https://public-b", "https://own-node"]);
  });

  it("changes nothing when nobody answered", () => {
    expect(freshOrder(urls, [null, null, null])).toEqual(urls);
  });
});
