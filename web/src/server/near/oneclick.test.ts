import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowCheckout, checkoutStatus, quoteCheckout, resetCheckoutCache } from "./oneclick";

const ROUTER = "splits-router.ada.near";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const DEPOSIT = "0x1111111111111111111111111111111111111111";

type World = { split: unknown; registered: Set<string>; quote?: (body: Record<string, unknown>) => Response };

/** NEAR mainnet RPC and the 1Click API, faked by URL. Records every quote request body. */
function fake(world: World) {
  const quotes: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/v0/tokens")) return Response.json([{ assetId: BASE_USDC, blockchain: "base", symbol: "USDC", decimals: 6 }]);
    if (u.endsWith("/v0/quote")) {
      const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
      quotes.push(body);
      if (world.quote) return world.quote(body);
      return Response.json(
        { quote: { depositAddress: body.dry ? undefined : DEPOSIT, amountIn: "25252500", amountInFormatted: "25.2525", amountOut: body.amount, deadline: "2026-11-12T15:00:00Z", timeEstimate: 35 } },
        { status: 201 },
      );
    }
    if (u.includes("rpc")) {
      const params = (JSON.parse(String(init!.body)) as { params: { method_name: string; args_base64: string } }).params;
      const args = JSON.parse(Buffer.from(params.args_base64, "base64").toString()) as { account_id: string };
      const value = params.method_name === "get_split" ? world.split : world.registered.has(args.account_id) ? { total: "1250000000000000000000" } : null;
      return Response.json({ result: { result: [...Buffer.from(JSON.stringify(value))] } });
    }
    throw new Error(`unexpected ${u}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, quotes };
}

const SPLIT = {
  version: 2,
  shares: [
    { account_id: "tax.ada.near", bps: 3000, purpose: "tax" },
    { account_id: "ada.near", bps: 7000, purpose: "spending" },
  ],
};
const everyone = new Set([ROUTER, "tax.ada.near", "ada.near"]);
const input = { to: "ada.near", units: 25_000_000n, assetId: BASE_USDC, refundTo: "0x2222222222222222222222222222222222222222", dry: false };

beforeEach(() => {
  vi.stubEnv("NEAR_CHECKOUT_ROUTER", ROUTER);
  resetCheckoutCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("quoteCheckout", () => {
  it("asks 1Click to deliver exactly the amount to the router, with the split in the message", async () => {
    const { quotes } = fake({ split: SPLIT, registered: everyone });
    const q = await quoteCheckout(input);
    expect(q.depositAddress).toBe(DEPOSIT);
    expect(q.version).toBe(2);
    const body = quotes[0]!;
    expect(body).toMatchObject({
      swapType: "EXACT_OUTPUT",
      recipient: ROUTER,
      recipientType: "DESTINATION_CHAIN",
      destinationAsset: `nep141:${USDC}`,
      amount: "25000000",
      refundTo: input.refundTo,
      refundType: "ORIGIN_CHAIN",
      dry: false,
    });
    expect(JSON.parse(String(body.customRecipientMsg))).toEqual({ ref: q.ref, to: "ada.near", version: 2 });
  });

  it("issues no deposit address when someone in the split cannot hold USDC", async () => {
    const { quotes } = fake({ split: SPLIT, registered: new Set([ROUTER, "ada.near"]) });
    await expect(quoteCheckout(input)).rejects.toThrow(/tax\.ada\.near/);
    expect(quotes).toHaveLength(0);
  });

  it("issues no deposit address when the router itself cannot hold USDC", async () => {
    const { quotes } = fake({ split: SPLIT, registered: new Set(["tax.ada.near", "ada.near"]) });
    await expect(quoteCheckout(input)).rejects.toThrow(ROUTER);
    expect(quotes).toHaveLength(0);
  });

  it("refuses an account with no saved split on mainnet", async () => {
    fake({ split: null, registered: everyone });
    await expect(quoteCheckout(input)).rejects.toThrow(/no saved split/);
  });

  it("refuses a coin that is not in 1Click's list, and amounts out of range", async () => {
    fake({ split: SPLIT, registered: everyone });
    await expect(quoteCheckout({ ...input, assetId: "nep141:made-up.near" })).rejects.toThrow(/Choose a coin/);
    await expect(quoteCheckout({ ...input, units: 50_000n })).rejects.toThrow(/smallest/);
    await expect(quoteCheckout({ ...input, units: 2_000_000_000n })).rejects.toThrow(/largest/);
  });

  it("refuses a quote whose delivered amount is not the amount asked", async () => {
    fake({
      split: SPLIT,
      registered: everyone,
      quote: () => Response.json({ quote: { depositAddress: DEPOSIT, amountIn: "1", amountInFormatted: "1", amountOut: "24000000" } }, { status: 201 }),
    });
    await expect(quoteCheckout(input)).rejects.toThrow(/price changed/);
  });

  it("says a bad refund address plainly", async () => {
    fake({ split: SPLIT, registered: everyone, quote: () => Response.json({ message: "refundTo is not valid" }, { status: 400 }) });
    await expect(quoteCheckout(input)).rejects.toThrow(/not a valid Base address/);
  });

  it("is off when no mainnet router is set", async () => {
    vi.stubEnv("NEAR_CHECKOUT_ROUTER", "");
    fake({ split: SPLIT, registered: everyone });
    await expect(quoteCheckout(input)).rejects.toThrow(/not switched on/);
  });
});

describe("checkoutStatus", () => {
  it("links the NEAR delivery on the mainnet explorer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "SUCCESS",
          swapDetails: { originChainTxHashes: [{ hash: "0xabc", explorerUrl: "https://basescan.org/tx/0xabc" }], destinationChainTxHashes: [{ hash: "Hd1", explorerUrl: "x" }] },
        }),
      ),
    );
    const s = await checkoutStatus(DEPOSIT);
    expect(s.status).toBe("SUCCESS");
    expect(s.nearTx).toEqual({ hash: "Hd1", url: "https://nearblocks.io/txns/Hd1" });
  });

  it("refuses something that is not a deposit address before calling out", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(checkoutStatus("../../etc")).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("allowCheckout", () => {
  it("allows 20 quotes an hour per visitor, apart from status checks", () => {
    const now = 1_000_000;
    for (let i = 0; i < 20; i++) expect(allowCheckout("v1", "quote", now)).toBe(true);
    expect(allowCheckout("v1", "quote", now)).toBe(false);
    expect(allowCheckout("v1", "status", now)).toBe(true);
    expect(allowCheckout("v1", "quote", now + 3_600_001)).toBe(true);
  });
});
