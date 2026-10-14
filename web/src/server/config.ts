import { z } from "zod";
import { getAddress, isAddress, type Address } from "viem";
import { MAX_RECIPIENTS_CEILING } from "./domain/payouts";

const address = z
  .string()
  .refine((v) => isAddress(v), "must be a 0x address")
  .transform((v) => getAddress(v) as Address);

const usdcAmount = z.string().regex(/^\d+(\.\d{1,6})?$/, "must be a USDC amount like 25 or 2.50");

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const schema = z
  .object({
    SPLITS_MODE: z.enum(["preview", "live"]).default("preview"),
    APP_URL: z.url().default("http://localhost:3000"),

    // Postgres in live mode. Preview uses PGlite, in memory unless PGLITE_DIR is set.
    DATABASE_URL: z.string().optional(),
    PGLITE_DIR: z.string().optional(),

    CIRCLE_API_KEY: z.string().optional(),
    CIRCLE_ENTITY_SECRET: z.string().optional(),
    CIRCLE_WALLET_SET_ID: z.string().optional(),
    CIRCLE_TREASURY_WALLET_ID: z.string().optional(),
    CIRCLE_BLOCKCHAIN: z.enum(["ARC", "ARC-TESTNET"]).default("ARC"),
    // Optional. Circle's token id for USDC's ERC-20 interface; looked up from the treasury if unset.
    CIRCLE_USDC_TOKEN_ID: z.uuid().optional(),

    ARC_CHAIN_ID: z.coerce.number().int().positive().default(5042),
    ARC_RPC_URLS: z.string().default("https://rpc.mainnet.arc.io"),
    ARC_EXPLORER_URL: z.url().default("https://explorer.arc.io"),
    SPLITS_ROUTER_ADDRESS: address.optional(),
    USDC_ADDRESS: address.default(getAddress("0x3600000000000000000000000000000000000000")),

    // "screen" shows the sign-in code in the app instead of emailing it. Testnet only.
    EMAIL_PROVIDER: z.enum(["resend", "screen"]).default("resend"),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default("Splits <login@splits.local>"),

    WEBAUTHN_RP_NAME: z.string().default("Splits"),

    // Simulated card top-up. The card payment is fake; the USDC it releases from the treasury is
    // real in live mode, so every limit here is a spend ceiling. FUNDING_ENABLED=false stops it.
    FUNDING_ENABLED: bool.default(true),
    FUNDING_MAX_PER_TOPUP_USDC: usdcAmount.default("25"),
    FUNDING_PER_USER_DAILY_USDC: usdcAmount.default("25"),
    FUNDING_GLOBAL_DAILY_USDC: usdcAmount.default("100"),

    // Simulated FX: USDC per 1 unit of fiat, 6 decimals.
    FX_GBP_USDC: usdcAmount.default("1.27"),
    FX_EUR_USDC: usdcAmount.default("1.09"),
    FX_USD_USDC: usdcAmount.default("1"),

    // Receiver auto-splits ignore incoming amounts below this, so dust never costs gas.
    AUTO_SPLIT_MIN_USDC: usdcAmount.default("0.10"),

    // Most recipients one payment may have. Raise it as the user base grows, up to what one Arc
    // transaction can carry (MAX_RECIPIENTS_CEILING, measured on a mainnet fork).
    MAX_PAYOUT_RECIPIENTS: z.coerce.number().int().min(1).max(MAX_RECIPIENTS_CEILING).default(50),

    // Until a KYC provider is integrated nobody sends more than this: per payment, and per sender
    // in any rolling 24 hours. Visitors (no account) have their own pair so they can be set lower.
    SEND_LIMIT_PER_PAYMENT_USDC: usdcAmount.default("500"),
    SEND_LIMIT_DAILY_USDC: usdcAmount.default("500"),
    VISITOR_SEND_LIMIT_PER_PAYMENT_USDC: usdcAmount.default("500"),
    VISITOR_SEND_LIMIT_DAILY_USDC: usdcAmount.default("500"),
    VISITOR_CHECKS_PER_HOUR: z.coerce.number().int().min(1).default(20),
    // A backstop across all visitors together, since a visitor can drop cookies.
    VISITOR_CHECKS_GLOBAL_PER_HOUR: z.coerce.number().int().min(1).default(1000),

    // The Splits fee, paid by the sender on top. Basis points; 0 and 0 turns fees off.
    FEE_BPS: z.coerce.number().int().min(0).max(1000).default(150),
    FEE_MANY_BPS: z.coerce.number().int().min(0).max(1000).default(200),
    FEE_MANY_FROM_RECIPIENTS: z.coerce.number().int().min(2).default(10),
    // Where fees land. Defaults to the treasury; a live mainnet server must set it.
    FEE_WALLET_ADDRESS: address.optional(),

    // Behind the production proxy, the visitor's IP is the first x-forwarded-for hop.
    TRUST_PROXY: bool.default(false),
    // The RPC a visitor's wallet and browser use. ARC_RPC_URLS may be private to the server.
    ARC_PUBLIC_RPC_URL: z.url().optional(),

    // Background driver for payments nobody is watching. 0 turns the in-process loop off
    // (for example on serverless, where the cron route does the job instead).
    SWEEP_INTERVAL_MS: z.coerce.number().int().min(0).default(5000),
    CRON_SECRET: z.string().min(24).optional(),

    // Agentic mode ("Describe it, I split it"). Live servers need a Bedrock model or inference
    // profile ID; unset turns it off. Preview mode uses a built-in stand-in.
    AGENT_MODEL_ID: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).default("us-east-1"),
    AGENT_DRAFTS_PER_DAY: z.coerce.number().int().min(1).default(20),
    AGENT_DRAFTS_GLOBAL_PER_HOUR: z.coerce.number().int().min(1).default(300),

    // Deposits from other chains, moved to Arc with CCTP V2. Comma list of chain keys
    // (base, arb, op, matic, avax, uni, monad, eth); only chains with an active Gas Station
    // policy belong here. Preview mode offers base, arb and op when this is empty.
    DEPOSIT_CHAINS: z.string().default(""),
    // Optional RPC per source chain, "base=https://…,arb=https://…"; public endpoints otherwise.
    SOURCE_RPCS: z.string().default(""),
    // Circle's attestation service; defaults to mainnet or sandbox to match the network.
    IRIS_URL: z.url().optional(),

    // Earning pocket (Arc Earn Kit). Off unless EARN_ENABLED=true. A live server also pins one vault,
    // checked at start (USDC, active, vetted by Circle, enough liquidity) or Earn stays off.
    EARN_ENABLED: bool.default(false),
    EARN_VAULT_ADDRESS: address.optional(),
    EARN_MIN_LIQUIDITY_USDC: usdcAmount.default("10000"),
    // Arc Testnet has no vault vetted by Circle; a testnet server may set this to false. Mainnet never may.
    EARN_REQUIRE_CIRCLE_VETTED: bool.default(true),
    // Idle USDC in an Earning pocket below this waits, so small amounts don't cost gas.
    EARN_DEPOSIT_MIN_USDC: usdcAmount.default("1"),
  })
  .superRefine((env, ctx) => {
    if (env.SPLITS_MODE !== "live") return;
    const testnet = env.CIRCLE_BLOCKCHAIN === "ARC-TESTNET";
    const required = [
      "CIRCLE_API_KEY",
      "CIRCLE_ENTITY_SECRET",
      "CIRCLE_WALLET_SET_ID",
      "CIRCLE_TREASURY_WALLET_ID",
      "SPLITS_ROUTER_ADDRESS",
      "CRON_SECRET",
    ] as const;
    for (const key of required) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "required when SPLITS_MODE=live" });
    }
    if (!testnet && !env.FEE_WALLET_ADDRESS) {
      ctx.addIssue({ code: "custom", path: ["FEE_WALLET_ADDRESS"], message: "required when SPLITS_MODE=live on mainnet" });
    }
    // Testnet runs may use a local PGlite database and on-screen codes. Mainnet never may.
    if (!env.DATABASE_URL && !(testnet && env.PGLITE_DIR)) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "required when SPLITS_MODE=live (PGLITE_DIR is allowed on testnet only)" });
    }
    if (env.EMAIL_PROVIDER === "screen" && !testnet) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_PROVIDER"], message: "screen codes are allowed on testnet only" });
    }
    if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "required when EMAIL_PROVIDER=resend" });
    }
    const expectedChain = testnet ? 5042002 : 5042;
    if (env.ARC_CHAIN_ID !== expectedChain) {
      ctx.addIssue({ code: "custom", path: ["ARC_CHAIN_ID"], message: `must be ${expectedChain} for ${env.CIRCLE_BLOCKCHAIN}` });
    }
    if (!testnet && !env.EARN_REQUIRE_CIRCLE_VETTED) {
      ctx.addIssue({ code: "custom", path: ["EARN_REQUIRE_CIRCLE_VETTED"], message: "must stay true on mainnet" });
    }
    if (env.EARN_ENABLED && !env.EARN_VAULT_ADDRESS) {
      ctx.addIssue({ code: "custom", path: ["EARN_VAULT_ADDRESS"], message: "required when EARN_ENABLED=true on a live server" });
    }
  });

export type Config = z.infer<typeof schema> & {
  rpcUrls: string[];
  publicRpcUrl: string;
  rpId: string;
  origin: string;
};

export function parseConfig(source: Record<string, string | undefined>): Config {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const env = result.data;
  const url = new URL(env.APP_URL);
  const rpcUrls = env.ARC_RPC_URLS.split(",").map((u) => u.trim()).filter(Boolean);
  return {
    ...env,
    rpcUrls,
    publicRpcUrl: env.ARC_PUBLIC_RPC_URL ?? rpcUrls[0]!,
    rpId: url.hostname,
    origin: url.origin,
  };
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}
