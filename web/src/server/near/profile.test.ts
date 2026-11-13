import { describe, expect, it } from "vitest";
import { buildPayTx } from "@/lib/near/payment";
import { NEAR } from "@/lib/near/config";
import { paidLegs, validAvatar, walletPayment } from "./profile";

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

describe("walletPayment", () => {
  const legs = [{ account_id: "u-1234567890.splits-app.testnet", amount: "100000", purpose: "coffee" }];
  const call = (method: string, args: unknown) => ({ FunctionCall: { method_name: method, args: Buffer.from(JSON.stringify(args)).toString("base64"), deposit: "1" } });
  const chain = (result: unknown) => (async () => new Response(JSON.stringify({ result }))) as unknown as typeof fetch;
  const ok = (signer: string, receiver: string) => ({
    status: { SuccessValue: "" },
    transaction: { signer_id: signer, receiver_id: receiver, actions: [call("ft_transfer_call", { receiver_id: NEAR.router, amount: "100000", msg: JSON.stringify({ ref: "r", legs }) })] },
  });

  it("reads the parts of a successful payment by that wallet", async () => {
    expect(await walletPayment("h", "bo.testnet", chain(ok("bo.testnet", NEAR.token)))).toEqual(legs);
  });

  it("finds nothing in someone else's, a failed or a non-payment transaction", async () => {
    expect(await walletPayment("h", "bo.testnet", chain(ok("eve.testnet", NEAR.token)))).toEqual([]);
    expect(await walletPayment("h", "bo.testnet", chain({ ...ok("bo.testnet", NEAR.token), status: { Failure: {} } }))).toEqual([]);
    expect(await walletPayment("h", "bo.testnet", chain(ok("bo.testnet", "other-token.testnet")))).toEqual([]);
  });
});
