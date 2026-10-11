import type { Ctx } from "./context";
import type { Action } from "./services/actions";
import type { ProviderTxRow } from "./services/providerTx";
import type { Split } from "./services/splits";
import type { Transfer } from "./services/transfers";
import type { User, Wallet } from "./services/users";
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
  send: "Split and pay out on Arc",
};

export function transferView(ctx: Ctx, t: Transfer, steps: ProviderTxRow[] = []) {
  const quote = t.quote as { currency?: string; fiatMinor?: number; rate?: string } | null;
  return {
    id: t.id,
    kind: t.kind,
    status: t.status,
    splitId: t.splitId,
    amount: formatUsdc(BigInt(t.amount)),
    quote: quote?.currency
      ? {
          currency: quote.currency,
          fiat: ((quote.fiatMinor ?? 0) / 100).toFixed(2),
          rate: formatUsdc(BigInt(quote.rate ?? "0")),
          simulated: true,
        }
      : null,
    legs: t.expected.map((l) => ({ ...l, amount: formatUsdc(BigInt(l.amount)) })),
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
