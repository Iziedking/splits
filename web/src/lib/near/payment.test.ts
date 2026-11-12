import { describe, expect, it } from "vitest";
import {
  buildPayTx,
  checkList,
  divideByShares,
  equalCents,
  formatUnits,
  gasFor,
  isAccountId,
  newRef,
  parseCents,
  splitsEvents,
  txGas,
  verifyPayment,
  type Leg,
} from "./payment";

const ROUTER = "splits.kingizie.testnet";
const TOKEN = "usdc.testnet";

describe("accounts", () => {
  it("accepts named and implicit accounts and refuses the rest", () => {
    for (const ok of ["ada.testnet", "tax.ada.testnet", "a1_b-2.testnet", "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af"]) {
      expect(isAccountId(ok), ok).toBe(true);
    }
    for (const bad of ["Ada.testnet", "a", "ada..testnet", ".ada", "ada.", "ada testnet", "ada@testnet", "-ada.testnet"]) {
      expect(isAccountId(bad), bad).toBe(false);
    }
  });
});

describe("money", () => {
  it("parses whole cents only", () => {
    expect(parseCents("12.5")).toBe(1250n);
    expect(parseCents("$1,250.50")).toBe(125050n);
    expect(parseCents("0")).toBeNull();
    expect(parseCents("1.234")).toBeNull();
    expect(parseCents("abc")).toBeNull();
  });

  it("splits 100.00 between 7 as four of 14.29 and three of 14.28, always adding up", () => {
    const parts = equalCents(10_000n, 7);
    expect(parts).toEqual([1429n, 1429n, 1429n, 1429n, 1428n, 1428n, 1428n]);
    expect(parts.reduce((a, b) => a + b)).toBe(10_000n);
  });

  it("divides by shares exactly like the contract", () => {
    const shares = [{ bps: 3000 }, { bps: 2000 }, { bps: 5000 }];
    expect(divideByShares(500_000n, shares)).toEqual([150_000n, 100_000n, 250_000n]);
    expect(divideByShares(10_001n, shares)).toEqual([3001n, 2000n, 5000n]);
    for (const a of [7n, 10_000n, 99_999_999n, 1_234_567_891n]) {
      expect(divideByShares(a, shares).reduce((x, y) => x + y)).toBe(a);
    }
  });

  it("formats micro-units", () => {
    expect(formatUnits(3_000_000n)).toBe("3.00");
    expect(formatUnits(150_000n)).toBe("0.15");
    expect(formatUnits(125n)).toBe("0.000125");
    expect(formatUnits(1_250_000_000n)).toBe("1,250.00");
  });
});

describe("checkList", () => {
  const line = (account: string, amount: string, purpose = "rent") => ({ account, amount, purpose });

  it("turns cents into token units", () => {
    const r = checkList([line("Ada.testnet ", "50"), line("@bo.testnet", "12.50", "food")], { me: "me.testnet", mode: "each" });
    expect(r.problems).toEqual([]);
    expect(r.legs).toEqual([
      { account_id: "ada.testnet", amount: "50000000", purpose: "rent" },
      { account_id: "bo.testnet", amount: "12500000", purpose: "food" },
    ]);
    expect(r.total).toBe(62_500_000n);
  });

  it("shares a pot equally in whole cents", () => {
    const lines = Array.from({ length: 7 }, (_, i) => line(`p${i}.testnet`, ""));
    const r = checkList(lines, { me: null, mode: "equal", pot: "100" });
    expect(r.legs.map((l) => l.amount)).toEqual(["14290000", "14290000", "14290000", "14290000", "14280000", "14280000", "14280000"]);
    expect(r.total).toBe(100_000_000n);
  });

  it("refuses duplicates, your own account, bad names, missing purposes and too many people", () => {
    const msgs = (r: ReturnType<typeof checkList>) => r.problems.map((p) => p.message).join(" | ");
    expect(msgs(checkList([line("ada.testnet", "5"), line("ADA.testnet", "5")], { me: null, mode: "each" }))).toMatch(/already on line 1/);
    expect(msgs(checkList([line("me.testnet", "5")], { me: "me.testnet", mode: "each" }))).toMatch(/your own account/);
    expect(msgs(checkList([line("ada@gmail.com", "5")], { me: null, mode: "each" }))).toMatch(/isn't a NEAR account/);
    expect(msgs(checkList([line("ada.testnet", "5", " ")], { me: null, mode: "each" }))).toMatch(/what this part is for/);
    const eleven = Array.from({ length: 11 }, (_, i) => line(`p${i}.testnet`, "1"));
    expect(msgs(checkList(eleven, { me: null, mode: "each" }))).toMatch(/At most 10/);
    // A list with problems never yields parts to sign.
    expect(checkList([line("ada.testnet", "5"), line("bad name", "5")], { me: null, mode: "each" }).legs).toEqual([]);
  });
});

describe("buildPayTx", () => {
  it("registers new recipients and sends the split in one transaction to the token", () => {
    const legs: Leg[] = [{ account_id: "ada.testnet", amount: "1000000", purpose: "tax" }];
    const tx = buildPayTx({ token: TOKEN, router: ROUTER, total: 1_000_000n, msg: { ref: "r1", legs }, parts: 1, unregistered: ["ada.testnet"] });
    expect(tx.receiverId).toBe(TOKEN);
    expect(tx.actions.map((a) => a.params.methodName)).toEqual(["storage_deposit", "ft_transfer_call"]);
    expect(tx.actions[0]!.params.args).toEqual({ account_id: "ada.testnet", registration_only: true });
    const call = tx.actions[1]!.params;
    expect(call.deposit).toBe("1");
    expect(call.args.receiver_id).toBe(ROUTER);
    expect(JSON.parse(call.args.msg as string)).toEqual({ ref: "r1", legs });
  });

  it("never asks for more than 300 TGas, even with ten new recipients", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `p${i}.testnet`);
    const tx = buildPayTx({ token: TOKEN, router: ROUTER, total: 10_000_000n, msg: {}, parts: 10, unregistered: ten });
    expect(txGas(tx)).toBeLessThanOrEqual(300n * 10n ** 12n);
    // The router still gets what it checks for (lib.rs: 15 + 10n + 10 + 2n TGas).
    expect(BigInt(tx.actions.at(-1)!.params.gas)).toBeGreaterThanOrEqual(BigInt(15 + 100 + 10 + 20) * 10n ** 12n);
    expect(gasFor(1)).toBeLessThan(gasFor(10));
  });

  it("makes references the router accepts", () => {
    const ref = newRef();
    expect(ref).toMatch(/^sp-[a-z2-9]{12}$/);
    expect(newRef()).not.toBe(ref);
  });
});

describe("verifyPayment", () => {
  const legs: Leg[] = [
    { account_id: "tax.kingizie.testnet", amount: "1000000", purpose: "tax" },
    { account_id: "mum.kingizie.testnet", amount: "800000", purpose: "upkeep for mum" },
  ];
  const payment = (landed: boolean[], overrides: Partial<Leg>[] = []) => ({
    receipts_outcome: [
      { outcome: { executor_id: TOKEN, logs: ['EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[]}'] } },
      {
        outcome: {
          executor_id: ROUTER,
          logs: [
            `EVENT_JSON:${JSON.stringify({
              standard: "splits",
              version: "1.0.0",
              event: "payment",
              data: [
                {
                  payer: "kingizie.testnet",
                  ref: "hand-1",
                  legs: legs.map((l, i) => ({ recipient: l.account_id, amount: l.amount, purpose: l.purpose, ...overrides[i], landed: landed[i] })),
                },
              ],
            })}`,
          ],
        },
      },
    ],
  });
  const expected = { payer: "kingizie.testnet", ref: "hand-1", legs };

  it("says Landed only when every approved part landed as approved", () => {
    const v = verifyPayment(splitsEvents(payment([true, true]), ROUTER), expected);
    expect(v.kind).toBe("landed");
  });

  it("reports a part that came back", () => {
    const v = verifyPayment(splitsEvents(payment([true, false]), ROUTER), expected);
    expect(v).toMatchObject({ kind: "partly", paid: 1_000_000n, refunded: 800_000n });
  });

  it("catches a part that differs from what was approved", () => {
    const v = verifyPayment(splitsEvents(payment([true, true], [{}, { amount: "900000" }]), ROUTER), expected);
    expect(v.kind).toBe("mismatch");
  });

  it("ignores splits-looking logs from any contract but the router", () => {
    const fake = payment([true, true]);
    fake.receipts_outcome[1]!.outcome.executor_id = "evil.testnet";
    expect(verifyPayment(splitsEvents(fake, ROUTER), expected).kind).toBe("unknown");
  });

  it("reads a refusal", () => {
    const refused = {
      receipts_outcome: [
        { outcome: { executor_id: ROUTER, logs: ['EVENT_JSON:{"standard":"splits","version":"1.0.0","event":"payment_refused","data":[{"reason":"ref_already_used"}]}'] } },
      ],
    };
    expect(verifyPayment(splitsEvents(refused, ROUTER), expected)).toEqual({ kind: "refused", reason: "ref_already_used" });
  });
});
