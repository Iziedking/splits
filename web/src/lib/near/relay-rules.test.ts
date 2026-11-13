import { describe, expect, it } from "vitest";
import { buildPayTx } from "./payment";
import { MAX_INNER_GAS, planRelay } from "./relay-rules";

const c = { token: "usdc.testnet", router: "splits.testnet", daoFactory: "sputnikv2.testnet" };
const call = (receiverId: string, methodName: string, args: Record<string, unknown>, deposit = "0", gas = "30000000000000") => ({
  receiverId,
  actions: [{ type: "FunctionCall" as const, params: { methodName, args, gas, deposit } }],
});

describe("what the relayer sends for an email account", () => {
  it("relays a payment and pays the recipients' registrations itself", () => {
    const tx = buildPayTx({ token: c.token, router: c.router, total: 1_000_000n, msg: { ref: "r", legs: [] }, parts: 2, unregistered: ["bo.testnet"] });
    const plan = planRelay(tx, c);
    expect(plan).toEqual({ register: ["bo.testnet"], calls: [expect.objectContaining({ receiverId: c.token, methodName: "ft_transfer_call", deposit: 1n })] });
  });

  it("allows saving a split and voting in a group", () => {
    expect("calls" in (planRelay(call(c.router, "set_split", { shares: [] }, "10000000000000000000000"), c) as object)).toBe(true);
    expect("calls" in (planRelay(call("flat.sputnikv2.testnet", "act_proposal", { id: 0, action: "VoteApprove" }), c) as object)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(planRelay(call(c.token, "ft_transfer", { receiver_id: "thief.testnet", amount: "5" }, "1"), c)).toEqual({ error: expect.any(String) });
    expect(planRelay(call(c.token, "ft_transfer_call", { receiver_id: "other.testnet", amount: "5", msg: "" }, "1"), c)).toEqual({ error: expect.stringMatching(/through Splits/) });
    expect(planRelay(call(c.router, "set_split", {}, "5000000000000000000000000"), c)).toEqual({ error: expect.stringMatching(/deposit/) });
    expect(planRelay(call("flat.sputnikv2.testnet", "act_proposal", {}, "1"), c)).toEqual({ error: expect.any(String) });
    expect(planRelay(call("sputnikv2.testnet", "create", {}, "6000000000000000000000000"), c)).toEqual({ error: expect.stringMatching(/NEAR wallet/) });
    expect(planRelay({ receiverId: c.token, actions: [] }, c)).toEqual({ error: expect.any(String) });
  });

  it("keeps the gas inside one transaction", () => {
    const plan = planRelay(call(c.router, "set_split", { shares: [] }, "0", "300000000000000"), c);
    expect("calls" in plan && plan.calls[0]!.gas).toBe(MAX_INNER_GAS);
  });
});
