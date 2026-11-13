"use client";

/**
 * "Divided just now": the latest payments the router divided, read from the chain by
 * /api/near/recent. Loaded after the page settles, so it never slows the first paint; hidden when
 * there is nothing recent. No names, emails or accounts: total, parts, purposes, when.
 */
import { useEffect, useState } from "react";
import { formatDollars } from "@/lib/near/payment";
import { useLiveDemoResult } from "./live-demo";

type Item = { hash: string; at: number; total: string; parts: number; purposes: string[]; demo: boolean };

function ago(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const cap = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

export function RecentStrip() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fresh = useLiveDemoResult();

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      fetch("/api/near/recent")
        .then((r) => (r.ok ? r.json() : { payments: [] }))
        .then((b: { payments?: Item[] }) => alive && setItems(b.payments ?? []))
        .catch(() => alive && setItems([]));
    }, 1200);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      clearTimeout(t);
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    if (!fresh) return;
    setNow(Date.now());
    setItems((list) => [{ hash: fresh.hash, at: Date.now(), total: fresh.total, parts: fresh.legs.length, purposes: fresh.legs.map((l) => l.purpose), demo: true }, ...(list ?? []).filter((i) => i.hash !== fresh.hash)].slice(0, 6));
  }, [fresh]);

  if (!items || items.length === 0) return null;
  return (
    <section aria-labelledby="recent-title" className="enter">
      <h2 id="recent-title" className="text-sm font-semibold tracking-wide text-muted-foreground">
        Divided just now on NEAR testnet
      </h2>
      <ul className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {items.map((i) => (
          <li key={i.hash} className="surface min-w-60 shrink-0 rounded-2xl px-4 py-3">
            <p className="flex items-baseline justify-between gap-3">
              <span className="font-semibold tabular-nums">{formatDollars(BigInt(i.total))}</span>
              <span className="text-xs text-muted-foreground">{ago(i.at, now)}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {i.parts} {i.parts === 1 ? "part" : "parts"}: {i.purposes.map(cap).join(", ")}
            </p>
            {i.demo && <p className="mt-1 text-xs font-medium text-primary-text">Demo payment</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
