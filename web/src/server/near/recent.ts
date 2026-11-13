/**
 * "Divided just now" on the landing page: the latest payments the splits router divided, read from
 * the chain. The list of transactions comes from the NearBlocks API (the router's receipts), each
 * payment's parts from the router's own `payment` event via RPC. No account names leave the server:
 * only the total, how many parts, each part's purpose and when.
 */
import { NEAR } from "@/lib/near/config";
import { splitsEvents } from "@/lib/near/payment";
import { demoPayer } from "./live-demo";

export type RecentPayment = { hash: string; at: number; total: string; parts: number; purposes: string[]; demo: boolean };

const API = NEAR.network === "mainnet" ? "https://api.nearblocks.io" : "https://api-testnet.nearblocks.io";
const KEEP = 6;
const FRESH_MS = 90_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;

let cache: { at: number; list: RecentPayment[] } | null = null;
let inflight: Promise<RecentPayment[]> | null = null;
const known = new Map<string, RecentPayment | null>(); // finished transactions never change

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(6000), cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * A purpose without anyone in it. Bill parts read "<bill>: <name>'s part" (lib/near/bill.ts), so the
 * name goes; emails and account names anywhere in a purpose are hidden too.
 */
export function publicPurpose(raw: string): string {
  let p = String(raw).trim();
  const bill = p.match(/^(.*): [^:]+'s part\b.*$/);
  if (bill) p = `${bill[1]!.trim()}, bill share`;
  if (/@/.test(p) || /\b[a-z0-9_-]+\.(near|testnet|tg)\b/i.test(p)) return "a payment";
  return p.slice(0, 40);
}

async function readPayment(hash: string, at: number): Promise<RecentPayment | null> {
  if (known.has(hash)) return known.get(hash)!;
  const tx = await getJson<{ data?: { signer_account_id?: string } }>(`${API}/v3/txns/${hash}`);
  const signer = tx?.data?.signer_account_id;
  if (!signer) return null; // try again next time
  const out = await getJson<{ result?: Parameters<typeof splitsEvents>[0] }>(NEAR.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "recent", method: "EXPERIMENTAL_tx_status", params: { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" } }),
  });
  if (!out?.result) return null;
  const payment = splitsEvents(out.result, NEAR.router).find((e) => e.event === "payment");
  const legs = (payment?.data.legs as { amount: string; purpose: string; landed: boolean }[] | undefined) ?? [];
  const landed = legs.filter((l) => l.landed);
  const item: RecentPayment | null = landed.length
    ? {
        hash,
        at,
        total: landed.reduce((a, l) => a + BigInt(l.amount), 0n).toString(),
        parts: landed.length,
        purposes: landed.map((l) => publicPurpose(l.purpose)),
        demo: payment?.data.payer === demoPayer(),
      }
    : null;
  known.set(hash, item);
  return item;
}

async function load(): Promise<RecentPayment[]> {
  const body = await getJson<{ data?: { transaction_hash: string; included_in_block_timestamp?: string; block?: { block_timestamp?: string }; actions?: { method?: string }[] }[] }>(
    `${API}/v3/accounts/${NEAR.router}/receipts?method=ft_on_transfer&per_page=25`,
  );
  if (!body?.data) return cache?.list ?? [];
  const seen = new Set<string>();
  const hashes: { hash: string; at: number }[] = [];
  for (const r of body.data) {
    if (!r.actions?.some((a) => a.method === "ft_on_transfer") || seen.has(r.transaction_hash)) continue;
    seen.add(r.transaction_hash);
    const at = Math.floor(Number(r.included_in_block_timestamp ?? r.block?.block_timestamp ?? 0) / 1e6);
    if (Date.now() - at > WEEK_MS) continue;
    hashes.push({ hash: r.transaction_hash, at });
    if (hashes.length >= KEEP) break;
  }
  const list: RecentPayment[] = [];
  for (const h of hashes) {
    const p = await readPayment(h.hash, h.at);
    if (p) list.push(p);
  }
  return list;
}

/** The latest divided payments, at most `KEEP`, from the past week; cached for 90 seconds. */
export async function recentPayments(): Promise<RecentPayment[]> {
  if (cache && Date.now() - cache.at < FRESH_MS) return cache.list;
  inflight ??= load()
    .then((list) => {
      cache = { at: Date.now(), list };
      return list;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
