/**
 * The server half of Split Checkout. It talks to the 1Click API (NEAR Intents) and checks NEAR
 * mainnet before any deposit address exists, so money is never sent somewhere it cannot land:
 *
 * - the recipient has a saved split on the mainnet router, and the payer is quoted that version;
 * - the router and every account in the split can hold USDC (registered for storage), because a
 *   part the token refuses would go back to the Intents contract, not to the payer;
 * - the message is built here from what NEAR says, never from what the browser sends.
 *
 * ONECLICK_JWT is optional. Without it 1Click adds 0.25% to each quote (docs.near-intents.org, Fees).
 */
import { CHECKOUT, CHECKOUT_MAX, CHECKOUT_MIN, checkoutEnabled, checkoutMsg, checkoutRef, payOptions, type IntentsToken, type PayOption } from "@/lib/near/checkout";
import { formatUnits } from "@/lib/near/payment";
import { viewAt, type SavedSplit } from "@/lib/near/rpc";

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

function headers(): Record<string, string> {
  const jwt = process.env.ONECLICK_JWT;
  return { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) };
}

let tokenCache: { at: number; options: PayOption[] } | null = null;

/** The coins a payer can choose. 1Click's list changes rarely, so it is kept for ten minutes. */
export async function getPayOptions(now = Date.now()): Promise<PayOption[]> {
  if (tokenCache && now - tokenCache.at < 600_000) return tokenCache.options;
  const res = await fetch(`${CHECKOUT.api}/v0/tokens`, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new CheckoutError("Paying from other wallets isn't available right now. Try again in a minute.", 502);
  const options = payOptions((await res.json()) as IntentsToken[]);
  tokenCache = { at: now, options };
  return options;
}

export function resetCheckoutCache() {
  tokenCache = null;
}

const mainnetView = <T>(contract: string, method: string, args: Record<string, unknown>) => viewAt<T>(CHECKOUT.rpc, contract, method, args);

async function canHoldUsdc(account: string): Promise<boolean> {
  return (await mainnetView<{ total: string } | null>(CHECKOUT.token, "storage_balance_of", { account_id: account })) !== null;
}

export type CheckoutQuote = {
  ref: string;
  to: string;
  version: number;
  shares: SavedSplit["shares"];
  /** USDC (6 decimals) that lands on NEAR and is divided. */
  amountOut: string;
  pay: { assetId: string; symbol: string; chainName: string };
  amountIn: string;
  amountInFormatted: string;
  /** What 1Click accepts at the least; more than amountIn is swapped and the rest refunded. */
  minAmountIn: string | null;
  depositAddress: string | null;
  depositMemo: string | null;
  deadline: string | null;
  timeEstimate: number | null;
};

type QuoteResponse = {
  quote?: {
    depositAddress?: string;
    depositMemo?: string | null;
    amountIn: string;
    amountInFormatted: string;
    minAmountIn?: string;
    amountOut: string;
    deadline?: string;
    timeEstimate?: number;
  };
  message?: string;
};

/**
 * Quote paying `units` of USDC to `to` from the coin `assetId`. With `dry` false, 1Click returns
 * the deposit address the payer sends to; it holds until the deadline.
 */
export async function quoteCheckout(input: { to: string; units: bigint; assetId: string; refundTo: string; dry: boolean }, now = Date.now()): Promise<CheckoutQuote> {
  if (!checkoutEnabled()) throw new CheckoutError("Paying from another chain is not switched on here.", 404);
  if (input.units < CHECKOUT_MIN) throw new CheckoutError(`The smallest checkout is ${formatUnits(CHECKOUT_MIN)} USDC.`);
  if (input.units > CHECKOUT_MAX) throw new CheckoutError(`The largest checkout for now is ${formatUnits(CHECKOUT_MAX)} USDC.`);

  const option = (await getPayOptions(now)).find((o) => o.assetId === input.assetId);
  if (!option) throw new CheckoutError("Choose a coin from the list.");

  const split = await mainnetView<SavedSplit | null>(CHECKOUT.router, "get_split", { account_id: input.to });
  if (!split) throw new CheckoutError(`${input.to} can't receive payments from other wallets yet (no saved split).`);

  const accounts = [CHECKOUT.router, ...split.shares.map((s) => s.account_id)];
  const held = await Promise.all(accounts.map(canHoldUsdc));
  const missing = accounts.filter((_, i) => !held[i]);
  if (missing.length > 0) {
    throw new CheckoutError(`${input.to} isn't ready for this yet, so we stopped before you paid anything: ${missing.join(", ")} can't hold USDC.`, 409);
  }

  const ref = checkoutRef();
  const body = {
    dry: input.dry,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: option.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: CHECKOUT.tokenAsset,
    amount: input.units.toString(),
    recipient: CHECKOUT.router,
    recipientType: "DESTINATION_CHAIN",
    refundTo: input.refundTo,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(now + 20 * 60_000).toISOString(),
    referral: "splits",
    customRecipientMsg: checkoutMsg(ref, input.to, split.version),
  };
  const res = await fetch(`${CHECKOUT.api}/v0/quote`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  const out = (await res.json().catch(() => ({}))) as QuoteResponse;
  if (!res.ok || !out.quote) throw new CheckoutError(quoteProblem(out.message, option), res.status >= 500 ? 502 : 400);
  const q = out.quote;
  if (q.amountOut !== input.units.toString()) throw new CheckoutError("The price changed while we were asking. Try again.", 502);
  if (!input.dry && !q.depositAddress) throw new CheckoutError("We couldn't get a payment address. Try again.", 502);

  return {
    ref,
    to: input.to,
    version: split.version,
    shares: split.shares,
    amountOut: q.amountOut,
    pay: { assetId: option.assetId, symbol: option.symbol, chainName: option.chainName },
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    minAmountIn: q.minAmountIn ?? null,
    depositAddress: q.depositAddress ?? null,
    depositMemo: q.depositMemo ?? null,
    deadline: q.deadline ?? null,
    timeEstimate: q.timeEstimate ?? null,
  };
}

/** 1Click's errors, said plainly. Unknown ones pass through: they are short and specific. */
function quoteProblem(message: string | undefined, option: PayOption): string {
  if (!message) return "We couldn't get a price for this. Try again in a minute.";
  if (/refundTo/i.test(message)) return `That refund address is not a valid ${option.chainName} address.`;
  if (/too low|amount is too small|min/i.test(message)) return `That amount is too small to send from ${option.chainName}. Try a larger one.`;
  return `We couldn't get a price: ${message}`;
}

export type CheckoutProgress = {
  status: string;
  originTx: { hash: string; url: string } | null;
  nearTx: { hash: string; url: string } | null;
  refundedAmount: string | null;
  refundReason: string | null;
};

type StatusResponse = {
  status: string;
  swapDetails?: {
    originChainTxHashes?: { hash: string; explorerUrl: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl: string }[];
    refundedAmount?: string;
    refundReason?: string;
  };
};

const DEPOSIT = /^[A-Za-z0-9:_-]{20,128}$/;

export async function checkoutStatus(depositAddress: string, depositMemo?: string): Promise<CheckoutProgress> {
  if (!DEPOSIT.test(depositAddress)) throw new CheckoutError("Unknown deposit address.");
  const q = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) });
  const res = await fetch(`${CHECKOUT.api}/v0/status?${q}`, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (res.status === 404) throw new CheckoutError("We don't recognise that payment address.", 404);
  if (!res.ok) throw new CheckoutError("Still checking.", 502);
  const s = (await res.json()) as StatusResponse;
  const origin = s.swapDetails?.originChainTxHashes?.[0];
  const near = s.swapDetails?.destinationChainTxHashes?.[0];
  return {
    status: s.status,
    originTx: origin ? { hash: origin.hash, url: origin.explorerUrl } : null,
    nearTx: near ? { hash: near.hash, url: `${CHECKOUT.explorer}/txns/${near.hash}` } : null,
    refundedAmount: s.swapDetails?.refundedAmount ?? null,
    refundReason: s.swapDetails?.refundReason ?? null,
  };
}

const hits = new Map<string, number[]>();
const LIMITS = { quote: 20, status: 900 } as const;

/** Per visitor per hour: 20 quotes (each asks market makers for a price), 900 status checks. */
export function allowCheckout(visitor: string, kind: keyof typeof LIMITS, now = Date.now()): boolean {
  const key = `${kind}:${visitor}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= LIMITS[kind]) return false;
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 20_000) hits.clear();
  return true;
}
