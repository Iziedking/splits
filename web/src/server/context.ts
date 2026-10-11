import type { Address } from "viem";
import { createResendEmail, PreviewEmail, type EmailSender } from "./auth/email";
import type { RelyingParty } from "./auth/passkeys";
import type { ChainReader } from "./chain/types";
import { createViemChain } from "./chain/viemChain";
import { getConfig, type Config } from "./config";
import { createPgliteDb, createPostgresDb, type Db } from "./db/client";
import { ratesFromConfig, type FxRates } from "./domain/fx";
import { parseUsdc } from "./domain/money";
import { PREVIEW_TREASURY_WALLET_ID, PreviewArc } from "./preview/previewArc";
import { createCircleWallets, fetchCircleWebhookKey } from "./wallets/circle";
import type { WalletProvider } from "./wallets/types";

export type Limits = {
  fundingEnabled: boolean;
  maxPerTopUp: bigint;
  perUserDaily: bigint;
  globalDaily: bigint;
  autoSplitMin: bigint;
};

/** Everything a service needs. Built once per process; tests build their own. */
export type Ctx = {
  mode: "preview" | "live";
  db: Db;
  wallets: WalletProvider;
  chain: ChainReader;
  email: EmailSender;
  router: Address;
  usdc: Address;
  treasuryWalletId: string;
  rates: FxRates;
  limits: Limits;
  rp: RelyingParty;
  explorerUrl: string;
  now: () => Date;
  /** Base64 SPKI public key for a Circle webhook key id. */
  webhookKey: (keyId: string) => Promise<string>;
  /** Only in preview mode. */
  preview?: PreviewArc;
  previewEmail?: PreviewEmail;
};

export function limitsFromConfig(config: Config): Limits {
  return {
    fundingEnabled: config.FUNDING_ENABLED,
    maxPerTopUp: parseUsdc(config.FUNDING_MAX_PER_TOPUP_USDC),
    perUserDaily: parseUsdc(config.FUNDING_PER_USER_DAILY_USDC),
    globalDaily: parseUsdc(config.FUNDING_GLOBAL_DAILY_USDC),
    autoSplitMin: parseUsdc(config.AUTO_SPLIT_MIN_USDC),
  };
}

export function previewCtx(db: Db, config: Config, arc = new PreviewArc()): Ctx {
  const email = new PreviewEmail();
  return {
    mode: "preview",
    db,
    wallets: arc.walletProvider,
    chain: arc.chainReader,
    email,
    router: arc.router,
    usdc: arc.usdc,
    treasuryWalletId: PREVIEW_TREASURY_WALLET_ID,
    rates: ratesFromConfig(config),
    limits: limitsFromConfig(config),
    rp: { rpId: config.rpId, rpName: config.WEBAUTHN_RP_NAME, origin: config.origin },
    explorerUrl: config.ARC_EXPLORER_URL,
    now: () => new Date(),
    webhookKey: async () => {
      throw new Error("Webhooks are not used in preview mode");
    },
    preview: arc,
    previewEmail: email,
  };
}

async function buildCtx(config: Config): Promise<Ctx> {
  if (config.SPLITS_MODE === "preview") {
    return previewCtx(await createPgliteDb(config.PGLITE_DIR), config);
  }
  // parseConfig has already refused to start live mode without these.
  const router = config.SPLITS_ROUTER_ADDRESS!;
  return {
    mode: "live",
    db: await createPostgresDb(config.DATABASE_URL!),
    wallets: createCircleWallets({
      apiKey: config.CIRCLE_API_KEY!,
      entitySecret: config.CIRCLE_ENTITY_SECRET!,
      walletSetId: config.CIRCLE_WALLET_SET_ID!,
      blockchain: config.CIRCLE_BLOCKCHAIN,
      usdc: config.USDC_ADDRESS,
    }),
    chain: createViemChain({
      chainId: config.ARC_CHAIN_ID,
      rpcUrls: config.rpcUrls,
      explorerUrl: config.ARC_EXPLORER_URL,
      router,
      usdc: config.USDC_ADDRESS,
    }),
    email: createResendEmail(config.RESEND_API_KEY!, config.EMAIL_FROM),
    router,
    usdc: config.USDC_ADDRESS,
    treasuryWalletId: config.CIRCLE_TREASURY_WALLET_ID!,
    rates: ratesFromConfig(config),
    limits: limitsFromConfig(config),
    rp: { rpId: config.rpId, rpName: config.WEBAUTHN_RP_NAME, origin: config.origin },
    explorerUrl: config.ARC_EXPLORER_URL,
    now: () => new Date(),
    webhookKey: (keyId) => fetchCircleWebhookKey(config.CIRCLE_API_KEY!, keyId),
  };
}

const holder = globalThis as unknown as { __splitsCtx?: Promise<Ctx> };

export function getCtx(): Promise<Ctx> {
  holder.__splitsCtx ??= buildCtx(getConfig()).catch((err) => {
    holder.__splitsCtx = undefined;
    throw err;
  });
  return holder.__splitsCtx;
}
