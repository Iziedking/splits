"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { ConfirmDialog, type Proof } from "@/components/app/confirm-dialog";
import { CountUp } from "@/components/app/count-up";
import { FeeLines } from "@/components/app/fee-lines";
import { Ribbon } from "@/components/app/ribbon";
import { Button } from "@/components/ui/button";
import { inputClass, Notice } from "@/components/ui/field";
import { api, errorMessage, type ActionView, type SplitView, type TransferView } from "@/lib/api";
import { purposeFill } from "@/lib/palette";
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
type Preview = {
  amount: string;
  fee: string;
  feePercent: number;
  total: string;
  rate: string | null;
  simulatedCard: boolean;
  legs: { name: string; purpose: string; amount: string }[];
};

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
  const reduce = useReducedMotion();
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
    // Whole cents only: the split contract never pays fractions of a cent.
    return /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0 ? { splitId, fundWith, usdc: value } : null;
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
    <div className="enter pt-4">
      <Link href="/home" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
        Back
      </Link>
      <h1 className="mt-1 text-[2rem] leading-tight font-extrabold">How much are you sending?</h1>
      <p className="mt-2 inline-flex rounded-full bg-white/70 px-3 py-1 text-sm font-semibold ring-1 ring-white">Through {split.name}</p>

      <div className="surface mt-6 p-5">
        <div role="radiogroup" aria-label="Pay with" className="relative grid grid-cols-2 rounded-full bg-white/60 p-1 ring-1 ring-white">
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
                "relative z-10 min-h-11 rounded-full text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                fundWith === option ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {fundWith === option && (
                <motion.span
                  layoutId="fund-with"
                  className="absolute inset-0 -z-10 rounded-full bg-primary"
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              {option === "card" ? "Card" : `Wallet, $${balance}`}
            </button>
          ))}
        </div>

        <label htmlFor="send-amount" className="mt-6 block text-sm font-semibold">
          {fundWith === "card" ? "You send" : "Amount in USDC"}
        </label>
        <div className="mt-2 flex items-stretch gap-2">
          {fundWith === "card" && (
            <select
              aria-label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className={cn(inputClass, "w-24 font-semibold")}
            >
              {Object.keys(CURRENCIES).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
          <div className="relative flex-1">
            <span aria-hidden="true" className="figure pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-3xl text-muted-foreground">
              {symbol}
            </span>
            <input
              id="send-amount"
              className={cn(inputClass, "figure min-h-16 pl-11 text-4xl")}
              inputMode="decimal"
              placeholder="0.00"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </div>
        </div>
        {fundWith === "card" && (
          <p className="mt-2 text-sm text-muted-foreground">
            Simulated card: no card is charged. The USDC that arrives is {me.mode === "preview" ? "simulated in preview" : me.network === "arc-testnet" ? "Arc Testnet USDC" : "real"}.
          </p>
        )}

        <div className="mt-6 rounded-2xl bg-white/60 p-5 ring-1 ring-white" aria-live="polite">
          {preview ? (
            <>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-muted-foreground">They receive</span>
                <span className="figure text-3xl text-primary">
                  <CountUp value={preview.amount} />
                </span>
              </div>
              {preview.rate && <p className="text-right text-xs text-muted-foreground">1 {currency} = {preview.rate} USDC</p>}
              <Ribbon className="mt-4" height={8} parts={preview.legs.map((l) => ({ label: l.name, weight: Number(l.amount) }))} />
              <ul className="mt-4 space-y-2.5">
                {preview.legs.map((leg, i) => (
                  <li key={i} className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-2.5">
                      <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ backgroundColor: purposeFill(i) }} />
                      <span className="font-medium">{leg.name}</span>
                      <span className="text-sm text-muted-foreground">{leg.purpose}</span>
                    </span>
                    <span className="font-semibold tabular-nums">${leg.amount}</span>
                  </li>
                ))}
              </ul>
              <FeeLines className="mt-4 border-t border-border pt-3" fee={preview.fee} percent={preview.feePercent} total={preview.total} />
            </>
          ) : previewError ? (
            <p className="text-sm text-destructive">{previewError}</p>
          ) : (
            <>
              <Ribbon height={8} parts={split.legs.map((l) => ({ label: l.name, weight: l.percent ?? Number(l.fixed ?? 0) }))} />
              <p className="mt-3 text-sm text-muted-foreground">Enter an amount to see exactly what each person gets.</p>
            </>
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
          <div className="space-y-3 text-sm">
            <p className="figure text-4xl">${pending.transfer.amount}</p>
            <p className="text-muted-foreground">USDC through {split.name}</p>
            <FeeLines fee={pending.transfer.fee} percent={pending.transfer.feePercent} total={pending.transfer.total} />
            <Ribbon parts={pending.transfer.legs.map((l) => ({ label: l.name, weight: Number(l.amount) }))} />
            <ul className="space-y-1.5">
              {pending.transfer.legs.map((leg, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: purposeFill(i) }} />
                    {leg.name}
                  </span>
                  <span className="font-semibold tabular-nums">${leg.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
