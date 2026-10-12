import type { Address } from "viem";
import { bedrockModel } from "./agent/bedrock";
import { previewModel, type DraftModel } from "./agent/model";
import { createResendEmail, PreviewEmail, type EmailSender } from "./auth/email";
import type { RelyingParty } from "./auth/passkeys";
import type { ChainReader } from "./chain/types";
import { createViemChain } from "./chain/viemChain";
import { getConfig, type Config } from "./config";
import { createPgliteDb, createPostgresDb, type Db } from "./db/client";
import type { FeeRule } from "./domain/fees";
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
  maxPayoutRecipients: number;
  sendPerPayment: bigint;
  sendDaily: bigint;
  visitorPerPayment: bigint;
  visitorDaily: bigint;
  visitorChecksPerHour: number;
  visitorChecksGlobalPerHour: number;
  agentDraftsPerDay: number;
  agentDraftsGlobalPerHour: number;
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
  /** Used as the sender when probing whether a recipient can receive USDC. */
  treasuryAddress: Address;
  rates: FxRates;
  limits: Limits;
  rp: RelyingParty;
  explorerUrl: string;
  /** Public address of the app, used in emails. */
  appUrl: string;
  network: "arc" | "arc-testnet";
  chainId: number;
  /** The RPC handed to visitors' wallets. */
  publicRpcUrl: string;
  /** Read the client IP from x-forwarded-for (only behind our own proxy). */
  trustProxy: boolean;
  /** Fixed per payment at quote; changing these never touches a payment already quoted. */
  fees: { rule: FeeRule; address: Address };
  /** Agentic mode's model; null turns it off. */
  agent: DraftModel | null;
  /** Sign-in codes are returned to the screen instead of emailed (preview, or testnet on request). */
  showCodes: boolean;
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
    maxPayoutRecipients: config.MAX_PAYOUT_RECIPIENTS,
    sendPerPayment: parseUsdc(config.SEND_LIMIT_PER_PAYMENT_USDC),
    sendDaily: parseUsdc(config.SEND_LIMIT_DAILY_USDC),
    visitorPerPayment: parseUsdc(config.VISITOR_SEND_LIMIT_PER_PAYMENT_USDC),
    visitorDaily: parseUsdc(config.VISITOR_SEND_LIMIT_DAILY_USDC),
    visitorChecksPerHour: config.VISITOR_CHECKS_PER_HOUR,
    visitorChecksGlobalPerHour: config.VISITOR_CHECKS_GLOBAL_PER_HOUR,
    agentDraftsPerDay: config.AGENT_DRAFTS_PER_DAY,
    agentDraftsGlobalPerHour: config.AGENT_DRAFTS_GLOBAL_PER_HOUR,
  };
}

function networkOf(config: Config): Ctx["network"] {
  return config.CIRCLE_BLOCKCHAIN === "ARC-TESTNET" ? "arc-testnet" : "arc";
}

/** Settings shared by preview and live contexts. */
function chainSettings(config: Config, treasuryAddress: Address) {
  return {
    network: networkOf(config),
    chainId: config.ARC_CHAIN_ID,
    publicRpcUrl: config.publicRpcUrl,
    trustProxy: config.TRUST_PROXY,
    fees: {
      rule: { bps: config.FEE_BPS, manyBps: config.FEE_MANY_BPS, manyFrom: config.FEE_MANY_FROM_RECIPIENTS },
      address: config.FEE_WALLET_ADDRESS ?? treasuryAddress,
    },
  };
}

export function previewCtx(db: Db, config: Config, arc = new PreviewArc()): Ctx {
  const email = new PreviewEmail();
  const treasuryAddress = arc.walletAddress(PREVIEW_TREASURY_WALLET_ID)!;
  return {
    mode: "preview",
    db,
    wallets: arc.walletProvider,
    chain: arc.chainReader,
    email,
    router: arc.router,
    usdc: arc.usdc,
    treasuryWalletId: PREVIEW_TREASURY_WALLET_ID,
    treasuryAddress,
    rates: ratesFromConfig(config),
    limits: limitsFromConfig(config),
    rp: { rpId: config.rpId, rpName: config.WEBAUTHN_RP_NAME, origin: config.origin },
    explorerUrl: config.ARC_EXPLORER_URL,
    appUrl: config.APP_URL,
    ...chainSettings(config, treasuryAddress),
    showCodes: true,
    agent: previewModel(),
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
  // parseConfig has already refused to start live mode without these, and has limited the
  // PGlite and on-screen-code shortcuts to testnet.
  const router = config.SPLITS_ROUTER_ADDRESS!;
  const screenCodes = config.EMAIL_PROVIDER === "screen";
  const wallets = createCircleWallets({
    apiKey: config.CIRCLE_API_KEY!,
    entitySecret: config.CIRCLE_ENTITY_SECRET!,
    walletSetId: config.CIRCLE_WALLET_SET_ID!,
    blockchain: config.CIRCLE_BLOCKCHAIN,
    usdc: config.USDC_ADDRESS,
    usdcTokenId: config.CIRCLE_USDC_TOKEN_ID,
  });
  const treasuryAddress = await wallets.walletAddress(config.CIRCLE_TREASURY_WALLET_ID!);
  return {
    mode: "live",
    db: config.DATABASE_URL ? await createPostgresDb(config.DATABASE_URL) : await createPgliteDb(config.PGLITE_DIR),
    wallets,
    chain: createViemChain({
      chainId: config.ARC_CHAIN_ID,
      rpcUrls: config.rpcUrls,
      explorerUrl: config.ARC_EXPLORER_URL,
      router,
      usdc: config.USDC_ADDRESS,
    }),
    email: screenCodes ? new PreviewEmail() : createResendEmail(config.RESEND_API_KEY!, config.EMAIL_FROM),
    router,
    usdc: config.USDC_ADDRESS,
    treasuryWalletId: config.CIRCLE_TREASURY_WALLET_ID!,
    treasuryAddress,
    rates: ratesFromConfig(config),
    limits: limitsFromConfig(config),
    rp: { rpId: config.rpId, rpName: config.WEBAUTHN_RP_NAME, origin: config.origin },
    explorerUrl: config.ARC_EXPLORER_URL,
    appUrl: config.APP_URL,
    ...chainSettings(config, treasuryAddress),
    showCodes: screenCodes,
    agent: config.AGENT_MODEL_ID ? bedrockModel({ modelId: config.AGENT_MODEL_ID, region: config.AWS_REGION }) : null,
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
