import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import type { Ctx } from "./context";
import { healthReport } from "./health";
import { testCtx } from "./testing";

// getCtx() memoises the process context here; seeding it lets the real route run on a test ctx.
const holder = globalThis as unknown as { __splitsCtx?: Promise<Ctx> };

describe("health", () => {
  afterEach(() => {
    holder.__splitsCtx = undefined;
  });

  it("reports the network and chain and nothing else", async () => {
    const { ctx } = await testCtx();
    expect(healthReport(ctx)).toStrictEqual({ ok: true, network: "arc", chainId: 5042 });
  });

  it("names Arc Testnet when configured for it", async () => {
    const { ctx } = await testCtx({ CIRCLE_BLOCKCHAIN: "ARC-TESTNET", ARC_CHAIN_ID: "5042002" });
    expect(healthReport(ctx)).toStrictEqual({ ok: true, network: "arc-testnet", chainId: 5042002 });
  });

  it("answers GET /api/health without a session and is never cached", async () => {
    const { ctx } = await testCtx();
    holder.__splitsCtx = Promise.resolve(ctx);
    const res = await GET(new Request("http://localhost/api/health"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toStrictEqual({ ok: true, network: "arc", chainId: 5042 });
  });
});
