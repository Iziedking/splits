"use client";

import { Check, Copy, ExternalLink, Plus, X } from "lucide-react";
import * as React from "react";
import { PurposeDot } from "@/components/app/purpose-dot";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Field, Notice, inputClass } from "@/components/ui/field";
import { buttonProblems, buttonSnippet, buyPath, scriptSnippet, type ButtonConfig } from "@/lib/near/button";
import { DEMO_SHOP } from "@/lib/near/demo-shop";
import { CENT, formatUnits, normaliseAccount, parseCents } from "@/lib/near/payment";
import { cn } from "@/lib/utils";
import { useNearWallet } from "./wallet";

type Row = { account: string; percent: string; purpose: string };

const fromConfig = (c: ButtonConfig): Row[] => c.parts.map((p) => ({ account: p.account, percent: String(p.bps / 100), purpose: p.purpose }));

/** "70" or "12.5" percent to basis points; null when it is not a number with at most two decimals. */
function bpsOf(percent: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(percent.trim().replace(/%$/, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

/**
 * Set up a "Pay with Splits" button once: who gets which share of every sale, and the price. Out
 * come a link and a snippet to paste into any page. Nothing is saved anywhere; the link is the setup.
 */
export function ButtonSetup() {
  const { accountId } = useNearWallet();
  const [shop, setShop] = React.useState("");
  const [item, setItem] = React.useState("");
  const [mode, setMode] = React.useState<"fixed" | "open">("fixed");
  const [price, setPrice] = React.useState("");
  const [rows, setRows] = React.useState<Row[]>([
    { account: "", percent: "70", purpose: "supplier" },
    { account: "", percent: "20", purpose: "tax" },
    { account: "", percent: "10", purpose: "tips" },
  ]);
  const [origin, setOrigin] = React.useState("");

  React.useEffect(() => setOrigin(window.location.origin), []);

  const cents = parseCents(price);
  const config: ButtonConfig = {
    shop,
    item: item.trim() || null,
    amount: mode === "open" ? null : cents === null ? null : cents * CENT,
    parts: rows.map((r) => ({ account: normaliseAccount(r.account), bps: bpsOf(r.percent) ?? -1, purpose: r.purpose })),
  };
  const problems = [...(mode === "fixed" && cents === null ? ["Set the price, like 1 or 12.50, or choose an open amount."] : []), ...buttonProblems(config)];
  const ready = problems.length === 0;
  const url = ready && origin ? `${origin}${buyPath(config)}` : null;
  const total = rows.reduce((a, r) => a + (bpsOf(r.percent) ?? 0), 0);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section aria-labelledby="setup-title" className="surface rounded-3xl p-6 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="setup-title" className="text-lg font-semibold">
            Your checkout
          </h2>
          <button
            type="button"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-text underline-offset-4 hover:underline"
            onClick={() => (setShop(DEMO_SHOP.shop), setItem(DEMO_SHOP.item ?? ""), setMode("fixed"), setPrice(formatUnits(DEMO_SHOP.amount!)), setRows(fromConfig(DEMO_SHOP)))}
          >
            Fill the coffee shop example
          </button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Shop or app name" placeholder="Kofi & Co." value={shop} onChange={(e) => setShop(e.target.value)} />
          <Field label="What they buy (optional)" placeholder="House blend, 250 g" value={item} onChange={(e) => setItem(e.target.value)} />
        </div>

        <div className="mt-5">
          <p className="mb-1.5 text-sm font-medium">Price</p>
          <Segmented
            kind="radio"
            label="Price"
            options={[
              { value: "fixed", label: "Fixed price" },
              { value: "open", label: "Payer chooses" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as "fixed" | "open")}
          />
          {mode === "fixed" && <Field className="mt-3" label="Price (USDC)" inputMode="decimal" placeholder="1.00" value={price} onChange={(e) => setPrice(e.target.value)} />}
        </div>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium">Who gets which part of every sale</legend>
          <ul className="mt-2 space-y-3">
            {rows.map((r, i) => (
              <li key={i} className="rounded-2xl bg-white/60 p-3 ring-1 ring-white">
                <div className="flex items-center gap-2">
                  <PurposeDot index={i} />
                  <input
                    aria-label={`Part ${i + 1}: NEAR account`}
                    className={cn(inputClass, "font-mono text-base lg:text-sm")}
                    placeholder={i === 0 && accountId ? accountId : "account.testnet"}
                    autoCapitalize="none"
                    spellCheck={false}
                    value={r.account}
                    onChange={(e) => update(i, { account: e.target.value })}
                  />
                  {rows.length > 1 && (
                    <button type="button" aria-label={`Remove part ${i + 1}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-[6.5rem_1fr] gap-2">
                  <input aria-label={`Part ${i + 1}: share in percent`} className={inputClass} inputMode="decimal" value={r.percent} onChange={(e) => update(i, { percent: e.target.value })} />
                  <input aria-label={`Part ${i + 1}: what it is for`} className={inputClass} placeholder="what it's for" value={r.purpose} onChange={(e) => update(i, { purpose: e.target.value })} />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-3">
            {rows.length < 10 ? (
              <Button size="sm" variant="secondary" onClick={() => setRows((rs) => [...rs, { account: "", percent: "", purpose: "" }])}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add a part
              </Button>
            ) : (
              <span />
            )}
            <p className={cn("text-sm tabular-nums", total === 10_000 ? "text-success-text" : "text-muted-foreground")}>{total / 100}% of 100%</p>
          </div>
        </fieldset>
        {!ready && (shop || rows.some((r) => r.account)) && (
          <Notice className="mt-4">
            <ul className="space-y-1">
              {problems.slice(0, 4).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Notice>
        )}
      </section>

      <section aria-labelledby="get-title" className="space-y-4 lg:sticky lg:top-8 lg:self-start">
        <div className="surface rounded-3xl p-6 sm:p-7">
          <h2 id="get-title" className="text-lg font-semibold">
            Your button
          </h2>
          {url ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">This is what your customers see. Try it: it opens the real checkout.</p>
              <div className="mt-4 rounded-2xl bg-white/70 p-5 ring-1 ring-white" dangerouslySetInnerHTML={{ __html: buttonSnippet(url) }} />
              <Copyable className="mt-5" label="1. Paste this button anywhere on your page" value={buttonSnippet(url)} />
              <Copyable className="mt-4" label="2. Optional: open it over your page instead of a new tab" value={scriptSnippet(origin)} />
              <Copyable className="mt-4" label="Or share the link itself" value={url} />
              <a className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary-text underline-offset-4 hover:underline" href={url} target="_blank" rel="noreferrer">
                Open the checkout
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Fill in your checkout and the button appears here, ready to paste.</p>
          )}
        </div>
        <p className="px-2 text-xs text-muted-foreground">
          The button carries your split in its link, so it needs no account here and nothing is stored. Payers see every part before they approve, and each part goes straight to its
          owner.
        </p>
      </section>
    </div>
  );
}

export function Copyable({ label, value, className }: { label: string; value: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className={className}>
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-1.5 flex items-start gap-2">
        <pre className="max-h-28 min-w-0 flex-1 overflow-auto rounded-xl bg-white/70 px-3 py-2.5 font-mono text-micro break-all whitespace-pre-wrap ring-1 ring-white">{value}</pre>
        <Button
          size="sm"
          variant="secondary"
          aria-label={copied ? "Copied" : `Copy: ${label}`}
          onClick={() =>
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}
