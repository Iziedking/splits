import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";

describe("config", () => {
  it("defaults to preview with Arc mainnet values", () => {
    const c = parseConfig({});
    expect(c.SPLITS_MODE).toBe("preview");
    expect(c.ARC_CHAIN_ID).toBe(5042);
    expect(c.USDC_ADDRESS).toBe("0x3600000000000000000000000000000000000000");
    expect(c.rpcUrls).toEqual(["https://rpc.mainnet.arc.io"]);
    expect(c.rpId).toBe("localhost");
  });

  it("refuses to start live mode with any key missing", () => {
    expect(() => parseConfig({ SPLITS_MODE: "live" })).toThrow(/CIRCLE_API_KEY: required/);
    expect(() => parseConfig({ SPLITS_MODE: "live" })).toThrow(/SPLITS_ROUTER_ADDRESS: required/);
  });

  it("refuses malformed spend limits and addresses", () => {
    expect(() => parseConfig({ FUNDING_MAX_PER_TOPUP_USDC: "-5" })).toThrow();
    expect(() => parseConfig({ SPLITS_ROUTER_ADDRESS: "0x123" })).toThrow();
    expect(() => parseConfig({ FUNDING_ENABLED: "yes" })).toThrow();
  });
});
