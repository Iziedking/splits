"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { ConfirmDialog, type Proof } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { inputClass, Notice } from "@/components/ui/field";
import { api, errorMessage, type ActionView, type SplitView, type TransferView } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function SendPage() {
  return (
    <AppFrame>
      <Send />
    </AppFrame>
  );
}

const CURRENCIES = { GBP: "£", EUR: "€", USD: "$" } as const;
type Currency = keyof typeof CURRENCIES;
type Preview = { amount: string; rate: string | null; simulatedCard: boolean; legs: { name: string; purpose: string; amount: string }[] };

/** "10.5" -> 1050 pence; null when it isn't a money amount. */
function toMinor(value: string): number | null {
  if (!/^\d{1,5}(\.\d{0,2})?$/.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return minor > 0 ? minor : null;
}

function Send() {
  const { splitId } = useParams<{ splitId: string }>();
  const router = useRouter();
  const { me } = useMe();
  const [split, setSplit] = React.useState<SplitView | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [fundWith, setFundWith] = React.useState<"card" | "balance">("card");
  const [currency, setCurrency] = React.useState<Currency>("GBP");
  const [value, setValue] = React.useState("");
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<{ action: ActionView; transfer: TransferView } | null>(null);

  React.useEffect(() => {
    api<{ split: SplitView }>(`/api/splits/${splitId}`)
      .then((res) => setSplit(res.split))
      .catch((err) => setLoadError(errorMessage(err)));
  }, [splitId]);

  const body = React.useMemo(() => {
    if (fundWith === "card") {
      const fiatMinor = toMinor(value);
      return fiatMinor ? { splitId, fundWith, currency, fiatMinor } : null;
    }
    return /^\d+(\.\d{1,6})?$/.test(value) && Number(value) > 0 ? { splitId, fundWith, usdc: value } : null;
  }, [splitId, fundWith, currency, value]);

  // Ask the server for the exact breakdown a moment after typing stops.
  React.useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!body) return;
    const timer = setTimeout(() => {
      api<Preview>("/api/transfers/preview", { body })
        .then(setPreview)
        .catch((err) => setPreviewError(errorMessage(err)));
    }, 300);
    return () => clearTimeout(timer);
  }, [body]);

  async function review() {
    if (!body) return;
    setBusy(true);
    try {
      setPending(await api<{ action: ActionView; transfer: TransferView }>("/api/transfers", { body }));
    } catch (err) {
      setPreviewError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(proof: Proof) {
    if (!pending) return;
    const res = await api<{ transfer: TransferView }>("/api/transfers/confirm", {
      body: { actionId: pending.action.id, ...proof },
    });
    // Leave the dialog in its busy state until the tracker takes over.
    router.replace(`/payments/${res.transfer.id}`);
  }

  if (loadError) return <Notice tone="error" className="mx-auto mt-8 max-w-md">{loadError}</Notice>;
  if (!split) return <div aria-busy="true" aria-label="Loading" className="mx-auto mt-8 h-96 max-w-md rounded-2xl bg-muted/60 motion-safe:animate-pulse" />;

  const balance = me.wallets.find((w) => w.kind === "main")?.balance ?? "0.00";
  const symbol = fundWith === "card" ? CURRENCIES[currency] : "$";

  return (
    <div className="enter mx-auto max-w-md pt-4">
      <Link href="/home" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
        Back
      </Link>
      <div className="mt-2 rounded-2xl bg-card p-6 shadow-lg">
        <h1 className="text-lg font-medium text-muted-foreground">Send through {split.name}</h1>

        <div role="radiogroup" aria-label="Pay with" className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-1">
          {(["card", "balance"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={fundWith === option}
              onClick={() => {
                setFundWith(option);
                setValue("");
              }}
              className={cn(
                "min-h-11 rounded-lg text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                fundWith === option ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {option === "card" ? "Card" : `Wallet ($${balance})`}
            </button>
          ))}
        </div>

        <label htmlFor="send-amount" className="mt-6 block text-sm font-medium">
          {fundWith === "card" ? "You send" : "Amount in USDC"}
        </label>
        <div className="mt-1.5 flex gap-2">
          {fundWith === "card" && (
            <select
              aria-label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className={cn(inputClass, "w-24")}
            >
              {Object.keys(CURRENCIES).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
          <div className="relative flex-1">
            <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-2xl font-bold text-muted-foreground">
              {symbol}
            </span>
            <input
              id="send-amount"
              className={cn(inputClass, "min-h-14 pl-9 text-3xl font-bold tabular-nums")}
              inputMode="decimal"
              placeholder="0.00"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </div>
        </div>
        {fundWith === "card" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Simulated card: no card is charged. The USDC that arrives is {me.mode === "live" ? "real" : "simulated in preview"}.
          </p>
        )}

        <div className="mt-6 rounded-xl bg-muted/50 p-4" aria-live="polite">
          {preview ? (
            <>
              <p className="flex justify-between text-sm">
                <span className="text-muted-foreground">They receive in total</span>
                <span className="font-semibold tabular-nums">${preview.amount} USDC</span>
              </p>
              {preview.rate && <p className="mt-1 text-xs text-muted-foreground">Rate 1 {currency} = {preview.rate} USDC</p>}
              <ul className="mt-4 space-y-2">
                {preview.legs.map((leg, i) => (
                  <li key={i} className="flex justify-between gap-4 text-sm">
                    <span>
                      {leg.name} <span className="text-muted-foreground">for {leg.purpose}</span>
                    </span>
                    <span className="font-medium tabular-nums">${leg.amount}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : previewError ? (
            <p className="text-sm text-destructive">{previewError}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Enter an amount to see exactly what each person gets.</p>
          )}
        </div>

        <Button className="mt-6 w-full" disabled={!preview} busy={busy} onClick={() => void review()}>
          {preview ? `Send ${symbol}${value}` : "Send"}
        </Button>
      </div>

      <ConfirmDialog
        actionId={pending?.action.id ?? null}
        title="Approve this payment"
        hasPasskey={me.user.hasPasskey}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      >
        {pending && (
          <div className="space-y-2 text-sm">
            <p className="text-3xl font-bold tracking-tight tabular-nums">${pending.transfer.amount}</p>
            <p className="text-muted-foreground">USDC through {split.name}</p>
            <ul className="space-y-1 pt-2">
              {pending.transfer.legs.map((leg, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span>{leg.name}</span>
                  <span className="tabular-nums">${leg.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
