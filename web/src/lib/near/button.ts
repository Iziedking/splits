/**
 * "Pay with Splits": a checkout button any shop or app can paste in. The merchant sets it up once
 * (a name, a fixed or open amount, and who gets which share of each sale, with a purpose on each),
 * and gets back a link and a button snippet. The link carries that setup, so the button needs no
 * account, server or contract change: the payer's one approval sends the total to the splits router
 * with the parts in the message, and the sale lands divided.
 */
import { PRIMARY_FILL, WHITE } from "../palette";
import { BPS_TOTAL, CENT, MAX_LEGS, MAX_PURPOSE_BYTES, divideByShares, formatUnits, isAccountId, normaliseAccount, parseCents, type Leg } from "./payment";

export type ButtonPart = { account: string; bps: number; purpose: string };
export type ButtonConfig = {
  /** The shop or app, as the payer should see it. */
  shop: string;
  /** What is being bought, if one thing. */
  item: string | null;
  /** A fixed price in USDC units, or null when the payer types the amount. */
  amount: bigint | null;
  parts: ButtonPart[];
};

export const MAX_SHOP = 60;
export const MAX_ITEM = 80;
/** Largest single checkout while this runs on testnet. */
export const MAX_BUTTON_UNITS = 100_000n * CENT;

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Everything wrong with a setup, in words a merchant can act on. Empty means it is good to use. */
export function buttonProblems(c: ButtonConfig): string[] {
  const out: string[] = [];
  if (!c.shop.trim()) out.push("Give the shop or app a name.");
  if (c.shop.length > MAX_SHOP) out.push(`Keep the name under ${MAX_SHOP} characters.`);
  if (c.item && c.item.length > MAX_ITEM) out.push(`Keep the item under ${MAX_ITEM} characters.`);
  if (c.amount !== null && (c.amount < CENT || c.amount > MAX_BUTTON_UNITS)) out.push(`Set a price between 0.01 and ${formatUnits(MAX_BUTTON_UNITS)} USDC.`);
  if (c.parts.length === 0) out.push("Add at least one person to pay.");
  if (c.parts.length > MAX_LEGS) out.push(`At most ${MAX_LEGS} people per sale.`);
  const seen = new Set<string>();
  c.parts.forEach((p, i) => {
    const n = i + 1;
    if (!isAccountId(p.account)) out.push(`Part ${n}: "${p.account || "(empty)"}" is not a NEAR account.`);
    else if (seen.has(p.account)) out.push(`Part ${n}: ${p.account} is listed twice.`);
    seen.add(p.account);
    if (!Number.isInteger(p.bps) || p.bps <= 0) out.push(`Part ${n}: give it a share above 0%.`);
    if (!p.purpose.trim()) out.push(`Part ${n}: say what it is for.`);
    else if (bytes(p.purpose) > MAX_PURPOSE_BYTES) out.push(`Part ${n}: keep the purpose shorter.`);
  });
  const total = c.parts.reduce((a, p) => a + (Number.isInteger(p.bps) ? p.bps : 0), 0);
  if (c.parts.length > 0 && total !== BPS_TOTAL) out.push(`The shares add up to ${total / 100}%; they must add up to 100%.`);
  if (c.amount !== null && out.length === 0 && legsFor(c, c.amount).some((l) => BigInt(l.amount) === 0n)) out.push("The price is too small to give every part something.");
  return out;
}

/** The exact parts of a sale of `units`, in the router's own arithmetic. */
export function legsFor(c: ButtonConfig, units: bigint): Leg[] {
  const amounts = divideByShares(
    units,
    c.parts.map((p) => ({ bps: p.bps })),
  );
  return c.parts.map((p, i) => ({ account_id: p.account, amount: amounts[i]!.toString(), purpose: p.purpose.trim() }));
}

// ------------------------------------------------------------------ the link

type Wire = { v: 1; s: string; i?: string; a?: string; p: [string, number, string][] };

export const toB64Url = (s: string) => {
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromB64Url = (s: string) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString("utf8");
};

export function encodeButton(c: ButtonConfig): string {
  const wire: Wire = { v: 1, s: c.shop.trim(), p: c.parts.map((p) => [normaliseAccount(p.account), p.bps, p.purpose.trim()]) };
  if (c.item?.trim()) wire.i = c.item.trim();
  if (c.amount !== null) wire.a = formatUnits(c.amount);
  return toB64Url(JSON.stringify(wire));
}

/** A setup from a link, or null when the link is damaged or the setup is not usable. */
export function decodeButton(code: string): ButtonConfig | null {
  if (!code || code.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  try {
    const w = JSON.parse(fromB64Url(code)) as Wire;
    if (w.v !== 1 || typeof w.s !== "string" || !Array.isArray(w.p)) return null;
    const amount = w.a === undefined ? null : parseCents(w.a);
    if (w.a !== undefined && amount === null) return null;
    const c: ButtonConfig = {
      shop: w.s,
      item: typeof w.i === "string" ? w.i : null,
      amount: amount === null ? null : amount * CENT,
      parts: w.p.map((x) => ({ account: String(x[0]), bps: Number(x[1]), purpose: String(x[2]) })),
    };
    return buttonProblems(c).length === 0 ? c : null;
  } catch {
    return null;
  }
}

/** A plain HTML shop on another domain (near/button-anywhere/index.html), proof the button works on any site. */
export const ELSEWHERE_SHOP_URL = "https://iziedking.github.io/splits-button-demo/";

export function buyPath(c: ButtonConfig): string {
  return `/near/buy?c=${encodeButton(c)}`;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The button to paste into any page: a plain link, styled inline, that works with no script. */
export function buttonSnippet(url: string, label = "Pay with Splits", newTab = true): string {
  return (
    `<a href="${escapeHtml(url)}" data-splits-checkout${newTab ? ' target="_blank" rel="noopener"' : ""} ` +
    `style="display:inline-flex;align-items:center;gap:8px;padding:12px 22px;border-radius:999px;background:${PRIMARY_FILL};color:${WHITE};` +
    `font:600 16px/1.2 system-ui,sans-serif;text-decoration:none">${escapeHtml(label)}</a>`
  );
}

/** The optional script: it opens the checkout in a window over the shop instead of a new tab. */
export function scriptSnippet(origin: string): string {
  return `<script src="${escapeHtml(origin)}/splits-button.js" async></script>`;
}
