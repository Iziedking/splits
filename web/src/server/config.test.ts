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

  const liveKeys = {
    SPLITS_MODE: "live",
    CIRCLE_API_KEY: "k",
    CIRCLE_ENTITY_SECRET: "s",
    CIRCLE_WALLET_SET_ID: "w",
    CIRCLE_TREASURY_WALLET_ID: "t",
    SPLITS_ROUTER_ADDRESS: "0x0000000000000000000000000000000000000001",
    CRON_SECRET: "x".repeat(32),
  };

  it("lets a testnet run use PGlite and on-screen codes", () => {
    const c = parseConfig({
      ...liveKeys,
      CIRCLE_BLOCKCHAIN: "ARC-TESTNET",
      ARC_CHAIN_ID: "5042002",
      PGLITE_DIR: "/tmp/splits",
      EMAIL_PROVIDER: "screen",
    });
    expect(c.EMAIL_PROVIDER).toBe("screen");
  });

  it("never lets mainnet use those shortcuts or the wrong chain id", () => {
    const mainnet = { ...liveKeys, DATABASE_URL: "postgres://x", RESEND_API_KEY: "r" };
    expect(() => parseConfig(mainnet)).not.toThrow();
    expect(() => parseConfig({ ...mainnet, EMAIL_PROVIDER: "screen" })).toThrow(/testnet only/);
    expect(() => parseConfig({ ...mainnet, DATABASE_URL: undefined, PGLITE_DIR: "/tmp/x" })).toThrow(/DATABASE_URL/);
    expect(() => parseConfig({ ...mainnet, ARC_CHAIN_ID: "5042002" })).toThrow(/must be 5042/);
    expect(() => parseConfig({ ...mainnet, RESEND_API_KEY: undefined })).toThrow(/RESEND_API_KEY/);
  });

  it("refuses malformed spend limits and addresses", () => {
    expect(() => parseConfig({ FUNDING_MAX_PER_TOPUP_USDC: "-5" })).toThrow();
    expect(() => parseConfig({ SPLITS_ROUTER_ADDRESS: "0x123" })).toThrow();
    expect(() => parseConfig({ FUNDING_ENABLED: "yes" })).toThrow();
  });
});
