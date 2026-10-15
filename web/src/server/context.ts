import type { Address } from "viem";
import { bedrockModel } from "./agent/bedrock";
import { previewModel, type DraftModel } from "./agent/model";
import { createResendEmail, PreviewEmail, type EmailSender } from "./auth/email";
import type { RelyingParty } from "./auth/passkeys";
import type { ChainReader } from "./chain/types";
import { createViemChain } from "./chain/viemChain";
import { getConfig, type Config } from "./config";
import { CCTP, crossPayChains, enabledChains, type CrossNetwork, type SourceChain } from "./crosschain/chains";
import { httpIris, type Iris } from "./crosschain/iris";
import { createSourceReader, type SourceReader } from "./crosschain/reader";
import { createPgliteDb, createPostgresDb, type Db } from "./db/client";
import { createLiveEarn } from "./earn/circle";
import type { EarnProvider } from "./earn/types";
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
  /** Idle Earning-pocket USDC below this stays out of the vault. */
  earnDepositMin: bigint;
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
  /** Deposits from other chains: the enabled chains, their reader, Circle's attestations, CCTP. */
  crossChain: CrossChain;
  /**
   * Cross-chain pay; null when off. `chains` are every configured chain, so payments already in flight
   * keep moving; `open` are the ones that passed the startup check and take new payments.
   */
  crossPay: { address: Address; chains: SourceChain[]; open: SourceChain[] } | null;
  /** The Earning pocket's vault; null keeps every Earn screen and route off. */
  earn: EarnProvider | null;
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
    earnDepositMin: parseUsdc(config.EARN_DEPOSIT_MIN_USDC),
  };
}

export type CrossChain = {
  network: CrossNetwork;
  chains: SourceChain[];
  reader: SourceReader;
  iris: Iris;
  cctp: { tokenMessenger: Address; messageTransmitter: Address };
};

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Live deposits: the chains in DEPOSIT_CHAINS, each checked at startup against its CCTP contract.
 * A chain whose MessageTransmitterV2 doesn't answer with the expected domain (wrong address, RPC
 * down) is left out and logged, so a bad chain never takes the whole app down.
 */
async function liveCrossChain(config: Config): Promise<CrossChain> {
  const network: CrossNetwork = config.CIRCLE_BLOCKCHAIN === "ARC" ? "mainnet" : "testnet";
  const overrides = Object.fromEntries(
    splitList(config.SOURCE_RPCS).map((pair) => {
      const i = pair.indexOf("=");
      return [pair.slice(0, i).trim(), pair.slice(i + 1).trim()];
    }),
  );
  const reader = createSourceReader(network, overrides);
  const wanted = enabledChains(splitList(config.DEPOSIT_CHAINS));
  const checked = await Promise.all(
    wanted.map(async (chain) => {
      try {
        const domain = await reader.cctpDomain(chain);
        if (domain === chain.domain) return chain;
        console.error(`[deposits] ${chain.name}: CCTP reports domain ${domain}, expected ${chain.domain}; chain left out`);
      } catch (err) {
        console.error(`[deposits] ${chain.name}: CCTP check failed (${err instanceof Error ? err.message : err}); chain left out`);
      }
      return null;
    }),
  );
  return {
    network,
    chains: checked.filter((c): c is SourceChain => c !== null),
    reader,
    iris: httpIris(config.IRIS_URL ?? (network === "mainnet" ? "https://iris-api.circle.com" : "https://iris-api-sandbox.circle.com")),
    cctp: CCTP[network],
  };
}

/**
 * Cross-chain pay: the contract must be SplitsCrossPay wired to this USDC, this network's
 * transmitter and TokenMessenger, and this router, or the feature stays off. Each chain must answer
 * with its CCTP domain and EVM id; one that doesn't is left out and logged.
 */
async function liveCrossPay(config: Config, chain: ChainReader, crossChain: CrossChain, router: Address): Promise<Ctx["crossPay"]> {
  const keys = splitList(config.CROSS_PAY_CHAINS);
  if (keys.length === 0 || !config.CROSS_PAY_ADDRESS) return null;
  const configured = crossPayChains(keys);
  let wiring: Awaited<ReturnType<ChainReader["crossPayWiring"]>>;
  try {
    wiring = await chain.crossPayWiring(config.CROSS_PAY_ADDRESS);
  } catch (err) {
    // Arc couldn't be read just now: keep payments in flight moving, take no new ones until restart.
    console.error(`[cross-pay] couldn't read ${config.CROSS_PAY_ADDRESS} (${err instanceof Error ? err.message : err}); no new cross-chain payments`);
    return { address: config.CROSS_PAY_ADDRESS, chains: configured, open: [] };
  }
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const ok =
    wiring &&
    same(wiring.usdc, config.USDC_ADDRESS) &&
    same(wiring.transmitter, crossChain.cctp.messageTransmitter) &&
    same(wiring.tokenMessenger, crossChain.cctp.tokenMessenger) &&
    same(wiring.router, router);
  if (!ok) {
    console.error(`[cross-pay] ${config.CROSS_PAY_ADDRESS} is not SplitsCrossPay for this router, USDC and CCTP; cross-chain pay is off`);
    return null;
  }
  const checked = await Promise.all(
    configured.map(async (c) => {
      try {
        const [domain, id] = await Promise.all([crossChain.reader.cctpDomain(c), crossChain.reader.chainId(c)]);
        if (domain === c.domain && id === c.chainId[crossChain.network]) return c;
        console.error(`[cross-pay] ${c.name}: domain ${domain}/${c.domain}, chain id ${id}/${c.chainId[crossChain.network]}; chain left out`);
      } catch (err) {
        console.error(`[cross-pay] ${c.name}: check failed (${err instanceof Error ? err.message : err}); chain left out`);
      }
      return null;
    }),
  );
  // A chain that failed its check takes no new payments, but its payments in flight still finish.
  return { address: config.CROSS_PAY_ADDRESS, chains: configured, open: checked.filter((c): c is SourceChain => c !== null) };
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
    earn: config.EARN_ENABLED ? arc.earnProvider : null,
    crossChain: {
      network: "testnet",
      chains: enabledChains(config.DEPOSIT_CHAINS ? splitList(config.DEPOSIT_CHAINS) : ["base", "arb", "op"]),
      reader: arc.sourceReader,
      iris: arc.iris,
      cctp: CCTP.testnet,
    },
    crossPay: (() => {
      const chains = crossPayChains(config.CROSS_PAY_CHAINS ? splitList(config.CROSS_PAY_CHAINS) : ["base", "eth", "arb", "op"]);
      return { address: arc.crossPay, chains, open: chains };
    })(),
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
  const chain = createViemChain({
    chainId: config.ARC_CHAIN_ID,
    rpcUrls: config.rpcUrls,
    explorerUrl: config.ARC_EXPLORER_URL,
    router,
    usdc: config.USDC_ADDRESS,
  });
  const crossChain = await liveCrossChain(config);
  return {
    mode: "live",
    db: config.DATABASE_URL ? await createPostgresDb(config.DATABASE_URL) : await createPgliteDb(config.PGLITE_DIR),
    wallets,
    chain,
    email: screenCodes ? new PreviewEmail() : createResendEmail(config.RESEND_API_KEY!, config.EMAIL_FROM, config.APP_URL),
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
    crossChain,
    crossPay: await liveCrossPay(config, chain, crossChain, router),
    earn:
      config.EARN_ENABLED && config.EARN_VAULT_ADDRESS
        ? await createLiveEarn({
            apiKey: config.CIRCLE_API_KEY!,
            entitySecret: config.CIRCLE_ENTITY_SECRET!,
            chain: config.CIRCLE_BLOCKCHAIN === "ARC" ? "Arc" : "Arc_Testnet",
            vault: config.EARN_VAULT_ADDRESS,
            minLiquidity: parseUsdc(config.EARN_MIN_LIQUIDITY_USDC),
            requireVetted: config.EARN_REQUIRE_CIRCLE_VETTED,
          })
        : null,
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
