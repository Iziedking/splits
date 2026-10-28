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

  it("isn't pushed around by one RPC reporting a wild height when the others agree", () => {
    expect(freshOrder(urls, [1000, 1001, 9_000_000])).toEqual(["https://own-node", "https://public-a", "https://public-b"]);
    expect(freshOrder(urls, [9_000_000, 1000, 1001])).toEqual(["https://public-a", "https://public-b", "https://own-node"]);
  });

  it("still trusts the higher of two that disagree, since a stuck node is the usual failure", () => {
    expect(freshOrder(urls.slice(0, 2), [900, 1000])).toEqual(["https://public-a", "https://own-node"]);
  });

  it("leaves out an RPC on another chain, however high its blocks", () => {
    expect(freshOrder(urls, [1000, 5_000_000, 1001], 30, [true, false, true])).toEqual(["https://own-node", "https://public-b"]);
  });
});
