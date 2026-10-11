import type { Ctx } from "./context";
import type { Action } from "./services/actions";
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
  return { id: user.id, email: user.email, hasPin: Boolean(user.pinHash), hasPasskey };
}

export function walletView(ctx: Ctx, w: Wallet & { balance?: bigint }) {
  return {
    id: w.id,
    kind: w.kind,
    label: w.label,
    address: w.address,
    explorerUrl: addressUrl(ctx, w.address),
    balance: w.balance === undefined ? null : formatUsdc(w.balance),
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
  const quote = t.quote as { currency?: string; fiatMinor?: number; rate?: string } | null;
  return {
    id: t.id,
    kind: t.kind,
    status: t.status,
    splitId: t.splitId,
    amount: formatUsdc(BigInt(t.amount)),
    fee: formatUsdc(BigInt(t.feeAmount)),
    feePercent: t.feeBps / 100,
    total: formatUsdc(BigInt(t.amount) + BigInt(t.feeAmount)),
    quote: quote?.currency
      ? {
          currency: quote.currency,
          fiat: ((quote.fiatMinor ?? 0) / 100).toFixed(2),
          rate: formatUsdc(BigInt(quote.rate ?? "0")),
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
    error: t.status === "failed" ? t.lastError : null,
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
export function visitorPaymentView(ctx: Ctx, t: Transfer, receipts: string[] | null) {
  return {
    ...transferView(ctx, t, [], receipts),
    token: t.visitorToken,
    /** The wallet this reservation is for; the page refuses to sign from any other. */
    payer: t.payerAddress,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    ref: t.ref,
    router: ctx.router,
    usdc: ctx.usdc,
  };
}
