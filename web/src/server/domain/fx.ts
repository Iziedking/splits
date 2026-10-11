import { CENT } from "./allocation";
import { parseUsdc } from "./money";

export const FIAT_CURRENCIES = ["GBP", "EUR", "USD"] as const;
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number];

export type FxRates = Record<FiatCurrency, bigint>;

export type Quote = {
  currency: FiatCurrency;
  fiatMinor: number;
  /** USDC (6 decimals) per 1 unit of fiat. */
  rate: string;
  usdc: string;
  /** Always true. Card funding and FX are simulated; the USDC leg is real in live mode. */
  simulated: true;
};

export class QuoteError extends Error {}

export function ratesFromConfig(config: { FX_GBP_USDC: string; FX_EUR_USDC: string; FX_USD_USDC: string }): FxRates {
  return { GBP: parseUsdc(config.FX_GBP_USDC), EUR: parseUsdc(config.FX_EUR_USDC), USD: parseUsdc(config.FX_USD_USDC) };
}

/**
 * fiatMinor is pence or cents. The USDC total is rounded down to a whole cent before it is split,
 * so the quote never promises more than it pays and every share stays in cents.
 */
export function quote(currency: FiatCurrency, fiatMinor: number, rates: FxRates): Quote & { usdcAmount: bigint } {
  if (!Number.isSafeInteger(fiatMinor) || fiatMinor <= 0) throw new QuoteError("Enter an amount above zero");
  if (fiatMinor > 1_000_000) throw new QuoteError("The limit is 10,000 per transfer");
  const rate = rates[currency];
  const usdcAmount = (BigInt(fiatMinor) * rate) / 100n / CENT * CENT;
  if (usdcAmount === 0n) throw new QuoteError("That amount is too small to send");
  return {
    currency,
    fiatMinor,
    rate: rate.toString(),
    usdc: usdcAmount.toString(),
    usdcAmount,
    simulated: true,
  };
}
