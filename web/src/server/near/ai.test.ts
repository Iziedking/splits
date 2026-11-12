import { afterEach, describe, expect, it, vi } from "vitest";
import { allowRead, readInstruction, readList } from "./ai";

const answer = (content: string) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as unknown as typeof fetch;

afterEach(() => {
  delete process.env.NEAR_AI_API_KEY;
});

describe("readInstruction", () => {
  it("uses the rules when they understand, without calling the model", async () => {
    process.env.NEAR_AI_API_KEY = "test";
    const fetcher = answer("{}");
    const r = await readInstruction("30% to tax.ada.testnet for tax, the rest stays", "ada.testnet", fetcher);
    expect(r.by).toBe("rules");
    expect(fetcher).not.toHaveBeenCalled();
    expect(r.shares.map((s) => s.bps)).toEqual([3000, 7000]);
  });

  it("guards the model: an account the person never typed is dropped", async () => {
    process.env.NEAR_AI_API_KEY = "test";
    const fetcher = answer(
      'Here you go: {"parts":[{"account":"tax.ada.testnet","percent":"thirty","purpose":"tax"},{"account":"evil.testnet","percent":"30","purpose":"fee"}],"rest":{"to_me":true,"purpose":"spending"},"notes":[]}',
    );
    const r = await readInstruction("put thirty percent aside to tax.ada.testnet please, 30 is fine", "ada.testnet", fetcher);
    expect(r.by).toBe("near-ai");
    expect(r.shares.find((s) => s.account_id === "evil.testnet")).toBeUndefined();
    expect(r.shares.reduce((a, s) => a + s.bps, 0)).toBe(10_000);
  });

  it("falls back to the rules when the model fails", async () => {
    process.env.NEAR_AI_API_KEY = "test";
    const fetcher = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const r = await readInstruction("split my income please", "ada.testnet", fetcher);
    expect(r.by).toBe("rules");
  });

  it("never calls the model without a key", async () => {
    const fetcher = answer("{}");
    await readInstruction("split my income please", "ada.testnet", fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("readList", () => {
  it("drops amounts the model invented", async () => {
    process.env.NEAR_AI_API_KEY = "test";
    const fetcher = answer('{"lines":[{"who":"ada.testnet","amount":"999","purpose":"rent"}],"notes":[]}');
    // The second line has no account, so the rules hand this to the model.
    const r = await readList("ada.testnet gets her rent, 50 dollars\nand Bo gets the rest", null, fetcher);
    expect(r.by).toBe("near-ai");
    expect(r.lines).toEqual([{ account: "ada.testnet", amount: "", purpose: "rent" }]);
  });
});

describe("allowRead", () => {
  it("caps one visitor at 30 an hour", () => {
    const t = Date.UTC(2026, 10, 12, 12);
    for (let i = 0; i < 30; i++) expect(allowRead("1.2.3.4", t + i)).toBe(true);
    expect(allowRead("1.2.3.4", t + 31)).toBe(false);
    expect(allowRead("5.6.7.8", t + 32)).toBe(true);
    expect(allowRead("1.2.3.4", t + 3_600_001)).toBe(true);
  });
});
