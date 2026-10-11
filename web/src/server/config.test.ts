import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";
import { MAX_RECIPIENTS_CEILING } from "./domain/payouts";

describe("config", () => {
  it("bounds MAX_PAYOUT_RECIPIENTS by the gas ceiling", () => {
    expect(parseConfig({ MAX_PAYOUT_RECIPIENTS: "75" }).MAX_PAYOUT_RECIPIENTS).toBe(75);
    expect(parseConfig({}).MAX_PAYOUT_RECIPIENTS).toBe(50);
    expect(() => parseConfig({ MAX_PAYOUT_RECIPIENTS: String(MAX_RECIPIENTS_CEILING + 1) })).toThrow("MAX_PAYOUT_RECIPIENTS");
    expect(() => parseConfig({ MAX_PAYOUT_RECIPIENTS: "0" })).toThrow("MAX_PAYOUT_RECIPIENTS");
  });

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
    const mainnet = {
      ...liveKeys,
      DATABASE_URL: "postgres://x",
      RESEND_API_KEY: "r",
      FEE_WALLET_ADDRESS: "0x0000000000000000000000000000000000000002",
    };
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

  it("caps sends at 500 USDC by default, separately for visitors", () => {
    const c = parseConfig({});
    expect(c.SEND_LIMIT_PER_PAYMENT_USDC).toBe("500");
    expect(c.SEND_LIMIT_DAILY_USDC).toBe("500");
    expect(c.VISITOR_SEND_LIMIT_PER_PAYMENT_USDC).toBe("500");
    expect(c.VISITOR_SEND_LIMIT_DAILY_USDC).toBe("500");
    expect(c.VISITOR_CHECKS_PER_HOUR).toBe(20);
    expect(c.TRUST_PROXY).toBe(false);
    expect(parseConfig({ VISITOR_SEND_LIMIT_DAILY_USDC: "100" }).VISITOR_SEND_LIMIT_DAILY_USDC).toBe("100");
    expect(() => parseConfig({ SEND_LIMIT_DAILY_USDC: "-1" })).toThrow("SEND_LIMIT_DAILY_USDC");
  });

  it("charges 1.5%, 2% from 10 recipients, bounded to 10%", () => {
    const c = parseConfig({});
    expect([c.FEE_BPS, c.FEE_MANY_BPS, c.FEE_MANY_FROM_RECIPIENTS]).toEqual([150, 200, 10]);
    expect(() => parseConfig({ FEE_BPS: "1001" })).toThrow("FEE_BPS");
    expect(() => parseConfig({ FEE_MANY_BPS: "-1" })).toThrow("FEE_MANY_BPS");
  });

  it("needs a fee wallet on a live mainnet server only", () => {
    expect(() => parseConfig({ ...liveKeys, DATABASE_URL: "postgres://x", RESEND_API_KEY: "r" })).toThrow(/FEE_WALLET_ADDRESS: required/);
    expect(() =>
      parseConfig({ ...liveKeys, CIRCLE_BLOCKCHAIN: "ARC-TESTNET", ARC_CHAIN_ID: "5042002", PGLITE_DIR: "/tmp/x", EMAIL_PROVIDER: "screen" }),
    ).not.toThrow();
  });

  it("uses the first RPC as the public one unless told otherwise", () => {
    expect(parseConfig({ ARC_RPC_URLS: "https://a.example,https://b.example" }).publicRpcUrl).toBe("https://a.example");
    expect(parseConfig({ ARC_PUBLIC_RPC_URL: "https://rpc.example" }).publicRpcUrl).toBe("https://rpc.example");
  });
});
