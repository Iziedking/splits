"use client";

import { Check, Copy } from "lucide-react";
import QRCode from "qrcode";
import * as React from "react";
import { StepList } from "@/components/app/step-list";
import { Button } from "@/components/ui/button";
import { Field, Notice, inputClass } from "@/components/ui/field";
import { CHECKOUT, CHECKOUT_MIN, isFinal, statusText, type PayOption } from "@/lib/near/checkout";
import { CENT, formatUnits, parseCents } from "@/lib/near/payment";
import { viewAt, type SavedSplit } from "@/lib/near/rpc";
import { INK, WHITE } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { SharesList } from "./split-flow";

type Quote = {
  ref: string;
  version: number;
  shares: SavedSplit["shares"];
  amountOut: string;
  pay: { assetId: string; symbol: string; chainName: string };
  amountIn: string;
  amountInFormatted: string;
  minAmountIn: string | null;
  depositAddress: string | null;
  depositMemo: string | null;
  deadline: string | null;
  timeEstimate: number | null;
};

type Progress = {
  status: string;
  originTx: { hash: string; url: string } | null;
  nearTx: { hash: string; url: string } | null;
  refundedAmount: string | null;
  refundReason: string | null;
};

const saved = (owner: string) => `splits-checkout:${owner}`;

function load(owner: string): Quote | null {
  try {
    const raw = window.localStorage.getItem(saved(owner));
    return raw ? (JSON.parse(raw) as Quote) : null;
  } catch {
    return null;
  }
}

function store(owner: string, q: Quote | null) {
  try {
    if (q) window.localStorage.setItem(saved(owner), JSON.stringify(q));
    else window.localStorage.removeItem(saved(owner));
  } catch {
    // Private windows: the checkout still works, it just will not survive a reload.
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? "Something went wrong. Try again.");
  return out;
}

/**
 * Split Checkout: pay `owner` from another chain and coin. NEAR Intents converts it and delivers
 * USDC on NEAR mainnet to the splits router, which divides it by `owner`'s saved split on arrival.
 */
export function CheckoutFlow({ owner, router }: { owner: string; router: string }) {
  const [split, setSplit] = React.useState<SavedSplit | null | undefined>(undefined);
  const [options, setOptions] = React.useState<PayOption[] | null>(null);
  const [amount, setAmount] = React.useState("");
  const [assetId, setAssetId] = React.useState("");
  const [refundTo, setRefundTo] = React.useState("");
  const [price, setPrice] = React.useState<Quote | null>(null);
  const [deposit, setDeposit] = React.useState<Quote | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDeposit(load(owner));
    viewAt<SavedSplit | null>(CHECKOUT.rpc, router, "get_split", { account_id: owner }).then(setSplit, () => setSplit(null));
    fetch("/api/near/checkout/options")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((j: { options: PayOption[] }) => {
        setOptions(j.options);
        setAssetId((a) => a || j.options[0]?.assetId || "");
      })
      .catch(() => setError("We couldn't load the ways to pay right now. Try again in a minute."));
  }, [owner, router]);

  const cents = parseCents(amount);
  const units = cents === null ? null : cents * CENT;
  const option = options?.find((o) => o.assetId === assetId) ?? null;

  // A price is for one amount, coin and refund address; changing any of them asks again.
  React.useEffect(() => setPrice(null), [amount, assetId, refundTo]);

  async function quote(dry: boolean) {
    setError(null);
    setBusy(true);
    try {
      const q = await post<Quote>("/api/near/checkout/quote", { to: owner, amount, assetId, refundTo: refundTo.trim(), dry });
      if (dry) setPrice(q);
      else {
        store(owner, q);
        setDeposit(q);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (deposit?.depositAddress) {
    return (
      <Shell owner={owner}>
        <DepositPanel
          owner={owner}
          quote={deposit}
          onDone={() => {
            store(owner, null);
            setDeposit(null);
            setPrice(null);
          }}
        />
      </Shell>
    );
  }

  const ready = units !== null && units >= CHECKOUT_MIN && option !== null && refundTo.trim().length >= 10;

  return (
    <Shell owner={owner}>
      {split === undefined && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
      {split === null && <Notice className="mt-4">{owner} can't receive payments from other wallets yet.</Notice>}
      {split && (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Pay with the coin you already have, on the network you already use. It arrives as USDC and divides like this:
          </p>
          <SharesList shares={split.shares} example={units ?? 100_000_000n} />

          <Field
            className="mt-5"
            label="Amount they receive (USDC)"
            inputMode="decimal"
            placeholder="25.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={amount && cents === null ? "Enter an amount like 25 or 12.50" : units !== null && units < CHECKOUT_MIN ? `The smallest checkout is ${formatUnits(CHECKOUT_MIN)} USDC` : null}
          />

          <div className="mt-4">
            <label htmlFor="pay-with" className="mb-1.5 block text-sm font-medium">
              Pay with
            </label>
            <select id="pay-with" className={cn(inputClass, "appearance-auto")} value={assetId} disabled={!options} onChange={(e) => setAssetId(e.target.value)}>
              {!options && <option value="">Loading coins…</option>}
              {groupByChain(options ?? []).map(([chain, list]) => (
                <optgroup key={chain} label={chain}>
                  {list.map((o) => (
                    <option key={o.assetId} value={o.assetId}>
                      {o.symbol} on {o.chainName}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <Field
            className="mt-4"
            label={`Your ${option?.chainName ?? "wallet"} address, for a refund`}
            hint="If the payment cannot complete, the money goes back here. Nothing else uses it."
            autoComplete="off"
            spellCheck={false}
            value={refundTo}
            onChange={(e) => setRefundTo(e.target.value)}
          />

          {price ? (
            <div className="mt-5 rounded-xl bg-white/70 p-4 ring-1 ring-white">
              <p className="text-sm text-muted-foreground">You send</p>
              <p className="figure mt-1 text-figure tabular-nums">
                {price.amountInFormatted} <span className="text-base font-semibold text-muted-foreground">{price.pay.symbol}</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                on {price.pay.chainName}, and {formatUnits(BigInt(price.amountOut))} USDC lands on NEAR, divided.
                {price.timeEstimate ? ` About ${Math.max(1, Math.round(price.timeEstimate / 60))} min.` : ""}
              </p>
              <Button className="mt-4 w-full" busy={busy} onClick={() => void quote(false)}>
                Get the deposit address
              </Button>
            </div>
          ) : (
            <Button className="mt-5 w-full" busy={busy} disabled={!ready} onClick={() => void quote(true)}>
              {units === null ? "See the price" : `See the price of ${formatUnits(units)} USDC`}
            </Button>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Your coin is converted to digital dollars (USDC) and divided automatically as it arrives. Splits never holds your money.
          </p>
        </>
      )}
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
    </Shell>
  );
}

function groupByChain(options: PayOption[]): [string, PayOption[]][] {
  const out = new Map<string, PayOption[]>();
  for (const o of options) out.set(o.chainName, [...(out.get(o.chainName) ?? []), o]);
  return [...out];
}

function Shell({ owner, children }: { owner: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl">
      <div className="surface rounded-2xl p-6 sm:p-7">
        <p className="text-sm font-medium text-primary-text">Pay from any wallet</p>
        <h1 className="mt-1 font-mono text-2xl font-semibold break-all sm:text-3xl">{owner}</h1>
        {children}
      </div>
    </div>
  );
}

const STEPS = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"] as const;

function DepositPanel({ owner, quote, onDone }: { owner: string; quote: Quote; onDone: () => void }) {
  const [progress, setProgress] = React.useState<Progress | null>(null);
  const [checkError, setCheckError] = React.useState<string | null>(null);
  const address = quote.depositAddress!;
  const final = progress ? isFinal(progress.status) : false;

  React.useEffect(() => {
    if (final) return;
    let live = true;
    const q = new URLSearchParams({ depositAddress: address, ...(quote.depositMemo ? { depositMemo: quote.depositMemo } : {}) });
    async function tick() {
      try {
        const res = await fetch(`/api/near/checkout/status?${q}`);
        const out = (await res.json()) as Progress & { error?: string };
        if (!live) return;
        if (res.ok) {
          setProgress(out);
          setCheckError(null);
        } else setCheckError(out.error ?? "Still checking");
      } catch {
        if (live) setCheckError("Lost the connection. Still checking");
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 5000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [address, quote.depositMemo, final]);

  const status = progress?.status ?? "PENDING_DEPOSIT";
  const step = STEPS.indexOf(status as (typeof STEPS)[number]);
  const landed = status === "SUCCESS";

  return (
    <div className="mt-4">
      {!final && (
        <>
          <p className="text-sm text-muted-foreground">
            Send exactly this from your {quote.pay.chainName} wallet. {formatUnits(BigInt(quote.amountOut))} USDC then reaches {owner} and divides automatically.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
            <div className="space-y-3">
              <CopyRow label="Amount" value={quote.amountInFormatted} suffix={`${quote.pay.symbol} on ${quote.pay.chainName}`} />
              <CopyRow label="To this deposit address" value={address} mono />
              {quote.depositMemo && <CopyRow label="With this memo (required)" value={quote.depositMemo} mono />}
            </div>
            <DepositQr value={address} />
          </div>
          {quote.deadline && <p className="mt-3 text-xs text-muted-foreground">Send before {new Date(quote.deadline).toLocaleTimeString()}. After that this address is not watched and you start again.</p>}
        </>
      )}

      <StepList
        className="mt-5"
        steps={STEPS.map((s, i) => ({
          key: s,
          label: statusText(s),
          state: i < step || landed ? "done" : final && i === Math.max(step, 0) ? "failed" : i === Math.max(step, 0) ? "active" : "waiting",
        }))}
      />
      <p className="sr-only" role="status">
        {statusText(status)}
      </p>

      {landed && (
        <>
          <Notice tone="success" className="mt-4">
            {formatUnits(BigInt(quote.amountOut))} USDC reached {owner} and was divided automatically.
          </Notice>
          <SharesList shares={quote.shares} example={BigInt(quote.amountOut)} />
        </>
      )}
      {final && !landed && (
        <Notice tone="error" className="mt-4">
          {statusText(status)}
          {progress?.refundReason ? ` (${progress.refundReason})` : ""}.
        </Notice>
      )}
      {checkError && !final && <p className="mt-3 text-sm text-muted-foreground">{checkError}…</p>}

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {progress?.originTx && (
          <a className="font-medium text-primary-text underline-offset-4 hover:underline" href={progress.originTx.url} target="_blank" rel="noreferrer">
            Proof of your payment
          </a>
        )}
        {progress?.nearTx && (
          <a className="font-medium text-primary-text underline-offset-4 hover:underline" href={progress.nearTx.url} target="_blank" rel="noreferrer">
            Proof of delivery
          </a>
        )}
      </div>

      <Button variant="secondary" className="mt-5 w-full" onClick={onDone}>
        {final ? "Make another payment" : "Cancel and start again"}
      </Button>
      {!final && <p className="mt-2 text-xs text-muted-foreground">Cancel only if you have not sent anything to this address.</p>}
    </div>
  );
}

function CopyRow({ label, value, suffix, mono }: { label: string; value: string; suffix?: string; mono?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-start gap-2">
        <p className={cn("min-w-0 flex-1 rounded-lg bg-white/70 px-3 py-2.5 break-all ring-1 ring-white", mono ? "font-mono text-micro" : "font-semibold tabular-nums")}>
          {value} {suffix && <span className="font-sans font-normal text-muted-foreground">{suffix}</span>}
        </p>
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Copy ${label.toLowerCase()}`}
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

/** Deposit addresses are letters, digits and a few separators; anything else is not drawn. */
const DEPOSIT = /^[A-Za-z0-9:_-]{20,128}$/;

function DepositQr({ value }: { value: string }) {
  const [svg, setSvg] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    if (!DEPOSIT.test(value)) return;
    void QRCode.toString(value, { type: "svg", margin: 1, color: { dark: INK, light: WHITE } }).then((out) => live && setSvg(out));
    return () => {
      live = false;
    };
  }, [value]);
  if (!DEPOSIT.test(value)) return null;
  return (
    <div
      role="img"
      aria-label="QR code of the deposit address"
      className="mx-auto h-40 w-40 overflow-hidden rounded-sm bg-white p-2 ring-1 ring-border [&_svg]:h-full [&_svg]:w-full"
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
