import type { Ctx } from "./context";
import { SOURCE_CHAINS, type ChainKey } from "./crosschain/chains";
import type { CrossPayment } from "./db/schema";
import { crossMessage } from "./services/crossMessages";
import { crossCallFor } from "./services/crossPay";
import type { Action } from "./services/actions";
import type { EarnMove } from "./services/earn";
import type { ProviderTxRow } from "./services/providerTx";
import type { Split } from "./services/splits";
import type { Transfer } from "./services/transfers";
import type { User, Wallet } from "./services/users";
import { greetingName } from "../lib/format";
import { formatUsdc } from "./domain/money";

/** JSON shapes for the API. Amounts go out as USDC decimal strings, never as raw bigints. */

const txUrl = (ctx: Ctx, hash: string | null | undefined) =>
  hash && ctx.mode === "live" ? `${ctx.explorerUrl}/tx/${hash}` : null;
const addressUrl = (ctx: Ctx, address: string) => (ctx.mode === "live" ? `${ctx.explorerUrl}/address/${address}` : null);

export function userView(user: User, hasPasskey: boolean) {
  return { id: user.id, email: user.email, hasPin: Boolean(user.pinHash), hasPasskey, emailAlerts: user.emailAlerts };
}

/**
 * GET /api/me: the signed-in person, their wallets and what this server lets them do. `demoCard`
 * is the test card (FUNDING_ENABLED): off on live mainnet, so no pay screen offers a card there.
 */
export function meView(ctx: Ctx, user: User, hasPasskey: boolean, wallets: (Wallet & { balance?: bigint })[]) {
  return {
    mode: ctx.mode,
    network: ctx.network,
    agent: ctx.agent !== null,
    earn: ctx.earn !== null,
    demoCard: ctx.limits.fundingEnabled,
    user: userView(user, hasPasskey),
    wallets: wallets.map((w) => walletView(ctx, w)),
  };
}

export function walletView(ctx: Ctx, w: Wallet & { balance?: bigint }) {
  return {
    id: w.id,
    kind: w.kind,
    label: w.label,
    address: w.address,
    explorerUrl: addressUrl(ctx, w.address),
    balance: w.balance === undefined ? null : formatUsdc(w.balance),
    /** The Earning pocket: its balance here leaves out what is in the vault (see /api/earn). */
    earn: w.earn,
  };
}

export function earnMoveView(ctx: Ctx, m: EarnMove) {
  return {
    id: m.id,
    kind: m.kind,
    amount: formatUsdc(BigInt(m.amount)),
    status: m.status,
    error: m.status === "failed" ? m.lastError : null,
    txUrl: m.txHash ? `${ctx.explorerUrl}/tx/${m.txHash}` : null,
    createdAt: m.createdAt.toISOString(),
  };
}

export function splitView(split: Split) {
  return {
    id: split.id,
    name: split.name,
    status: split.status,
    automatic: Boolean(split.autoForWalletId),
    autoForWalletId: split.autoForWalletId,
    onchainId: split.onchainId === null ? null : split.onchainId.toString(),
    version: split.version,
    error: split.lastError,
    legs: split.legs.map((l) => ({
      name: l.name,
      email: l.email,
      address: l.address,
      purpose: l.purpose,
      fixed: l.fixedAmount === "0" ? null : formatUsdc(BigInt(l.fixedAmount)),
      percent: l.shareBps === 0 ? null : l.shareBps / 100,
    })),
  };
}

export function actionView(action: Action) {
  return { id: action.id, type: action.type, expiresAt: action.expiresAt.toISOString() };
}

const STEP_LABELS: Record<string, string> = {
  fund: "Card top-up (simulated card, real USDC)",
  approve: "Allow the split contract to move this amount",
  send: "Pay everyone on Arc",
};

export function transferView(ctx: Ctx, t: Transfer, steps: ProviderTxRow[] = [], receipts: string[] | null = null) {
  const quote = t.quote as { currency?: string; fiatMinor?: number; rate?: string; whole?: string } | null;
  return {
    id: t.id,
    kind: t.kind,
    status: t.status,
    splitId: t.splitId,
    amount: formatUsdc(BigInt(t.amount)),
    fee: formatUsdc(BigInt(t.feeAmount)),
    feePercent: t.feeBps / 100,
    total: formatUsdc(BigInt(t.amount) + BigInt(t.feeAmount)),
    /** Through a split under 100%: the amount typed, of which `amount` (the shares) was sent. */
    whole: quote?.whole ? formatUsdc(BigInt(quote.whole)) : null,
    quote: quote?.currency
      ? {
          currency: quote.currency,
          fiat: ((quote.fiatMinor ?? 0) / 100).toFixed(2),
          rate: formatUsdc(BigInt(quote.rate ?? "0")),
          /** What the (simulated) card was charged in USDC: the recipients' total plus the fee. */
          charged: formatUsdc(BigInt(t.amount) + BigInt(t.feeAmount)),
          simulated: true,
        }
      : null,
    recipients: t.expected.length,
    legs: t.expected.map((l, i) => ({
      ...l,
      amount: formatUsdc(BigInt(l.amount)),
      receipt: receipts?.[i] ? `/r/${receipts[i]}` : null,
    })),
    txHash: t.txHash,
    explorerUrl: txUrl(ctx, t.txHash),
    // A visitor's reservation reopens after a reverted send; the reason stays visible while they retry.
    error: t.status === "failed" || t.status === "awaiting_wallet" || t.status === "cancelled" ? t.lastError : null,
    parentTransferId: t.parentTransferId,
    createdAt: t.createdAt.toISOString(),
    settledAt: t.settledAt?.toISOString() ?? null,
    steps: steps
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((s) => ({
        step: s.step,
        label: STEP_LABELS[s.step] ?? s.step,
        status: s.status,
        txHash: s.txHash,
        explorerUrl: txUrl(ctx, s.txHash),
      })),
  };
}

/**
 * One recipient's receipt, for a link anyone holding it can open. It names the sender by first
 * name only and leaves out the total and every other recipient.
 */
export function receiptView(ctx: Ctx, t: Transfer, legIndex: number, payer: { email: string | null; address: string }) {
  const leg = t.expected[legIndex]!;
  return {
    index: legIndex,
    /** True when this person was the payment's only recipient, so the receipt is the whole payment. */
    whole: t.expected.length === 1,
    name: leg.name,
    purpose: leg.purpose,
    amount: formatUsdc(BigInt(leg.amount)),
    to: leg.address,
    from: payer.email ? greetingName(payer.email) : `${payer.address.slice(0, 6)}…${payer.address.slice(-4)}`,
    fromAddress: payer.address,
    paidAt: (t.settledAt ?? t.updatedAt).toISOString(),
    txHash: t.txHash,
    explorerUrl: txUrl(ctx, t.txHash),
    network: ctx.network,
    simulated: ctx.mode === "preview",
  };
}

/** A visitor's payment, for the /p/<token> page. Carries what their wallet needs to pay it. */
export function visitorPaymentView(ctx: Ctx, t: Transfer, receipts: string[] | null, cross: CrossPayment | null = null) {
  return {
    ...transferView(ctx, t, [], receipts),
    token: t.visitorToken,
    /** The wallet this reservation is for; the page refuses to sign from any other. */
    payer: t.payerAddress,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    ref: t.ref,
    router: ctx.router,
    usdc: ctx.usdc,
    cross: cross ? crossPayView(ctx, t, cross) : null,
  };
}

/** A chain's name as the payer sees it: "Base", or "Base testnet" off mainnet. */
export function chainLabel(ctx: Ctx, key: string): string {
  const name = SOURCE_CHAINS[key as ChainKey]?.name ?? key;
  return ctx.crossChain.network === "testnet" ? `${name} testnet` : name;
}

/**
 * Where a payment from another chain is: the four steps, the message to show, links on both chains,
 * and (only while nothing has been burned yet) the burn the payer's wallet still has to send.
 */
function crossPayView(ctx: Ctx, t: Transfer, cp: CrossPayment) {
  const name = chainLabel(ctx, cp.chain);
  const state = crossMessage(t, cp, name);
  const chain = SOURCE_CHAINS[cp.chain as ChainKey];
  const canPay = cp.phase === "awaiting_burn" && t.status === "awaiting_wallet" && !cp.burnTxHash;
  return {
    chain: cp.chain,
    chainName: name,
    phase: cp.phase,
    step: state.step,
    tone: state.tone,
    message: state.text,
    burnTxHash: cp.burnTxHash,
    burnUrl: cp.burnTxHash && chain ? `${chain.explorer[ctx.crossChain.network]}/tx/${cp.burnTxHash}` : null,
    relayTxHash: cp.relayTxHash,
    relayUrl: txUrl(ctx, cp.relayTxHash),
    feeBack: cp.feeBack ? formatUsdc(BigInt(cp.feeBack)) : null,
    refundAmount: cp.refundAmount ? formatUsdc(BigInt(cp.refundAmount)) : null,
    owed: cp.phase === "owed",
    crossPay: ctx.crossPay?.address ?? null,
    canPay,
    call: canPay ? crossCallFor(ctx, t, cp) : null,
  };
}
