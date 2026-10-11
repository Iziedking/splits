import { z } from "zod";
import { getAddress, isAddress, type Address } from "viem";

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

    // Background driver for payments nobody is watching. 0 turns the in-process loop off
    // (for example on serverless, where the cron route does the job instead).
    SWEEP_INTERVAL_MS: z.coerce.number().int().min(0).default(5000),
    CRON_SECRET: z.string().min(24).optional(),
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
  });

export type Config = z.infer<typeof schema> & {
  rpcUrls: string[];
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
  return {
    ...env,
    rpcUrls: env.ARC_RPC_URLS.split(",").map((u) => u.trim()).filter(Boolean),
    rpId: url.hostname,
    origin: url.origin,
  };
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}
