import { describe, expect, it } from "vitest";
import { buildPayTx } from "@/lib/near/payment";
import { paidLegs, validAvatar } from "./profile";

const ROUTER = "splits.kingizie.testnet";

describe("paidLegs", () => {
  it("reads who a router payment pays", () => {
    const legs = [
      { account_id: "u-1234567890.splits-app.testnet", amount: "500000", purpose: "dinner" },
      { account_id: "tax.ada.testnet", amount: "300000", purpose: "tax" },
    ];
    const tx = buildPayTx({ token: "usdc.testnet", router: ROUTER, total: 800000n, msg: { ref: "r1", legs }, parts: 2, unregistered: [] });
    expect(paidLegs(tx, ROUTER)).toEqual(legs);
  });

  it("ignores anything that isn't a payment through the router", () => {
    const tx = buildPayTx({ token: "usdc.testnet", router: "someone-else.testnet", total: 1n, msg: { ref: "r1", legs: [{ account_id: "a.testnet", amount: "1", purpose: "" }] }, parts: 1, unregistered: [] });
    expect(paidLegs(tx, ROUTER)).toEqual([]);
    const setSplit = { receiverId: ROUTER, actions: [{ type: "FunctionCall" as const, params: { methodName: "set_split", args: { shares: [] }, gas: "1", deposit: "0" } }] };
    expect(paidLegs(setSplit, ROUTER)).toEqual([]);
  });

  it("drops parts with a bad account or amount", () => {
    const tx = buildPayTx({ token: "usdc.testnet", router: ROUTER, total: 1n, msg: { ref: "r", legs: [{ account_id: "NOT VALID", amount: "1", purpose: "" }, { account_id: "ok.testnet", amount: "1e6", purpose: "" }] }, parts: 2, unregistered: [] });
    expect(paidLegs(tx, ROUTER)).toEqual([]);
  });
});

describe("validAvatar", () => {
  it("takes a small image data URL", () => {
    expect(validAvatar("data:image/webp;base64,UklGRiQAAABXRUJQ")).toBe(true);
    expect(validAvatar("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBe(true);
  });
  it("refuses other content and anything too big", () => {
    expect(validAvatar("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(validAvatar("https://example.com/me.png")).toBe(false);
    expect(validAvatar("data:image/png;base64," + "A".repeat(90_000))).toBe(false);
  });
});
