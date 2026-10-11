"use client";

import { CircleAlert, ExternalLink, ReceiptText, Share2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { AppFrame, useFrameTone, useMe } from "@/components/app/app-frame";
import { CountUp } from "@/components/app/count-up";
import { ManualLink, receiptText, shareLink, ShareReceipts } from "@/components/app/receipt-share";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, errorMessage, type TransferView } from "@/lib/api";
import { isFinal } from "@/lib/format";
import { purposeFill } from "@/lib/palette";
import { cn } from "@/lib/utils";

export default function PaymentPage() {
  return (
    <AppFrame>
      <Payment />
    </AppFrame>
  );
}

const ORDER = ["confirmed", "funding", "approving", "sending", "verifying", "settled"] as const;
type Step = { key: string; label: string; reachedAt: (typeof ORDER)[number] };
type StepState = "done" | "active" | "waiting" | "failed";

/** The design's step list (S7), mapped onto the payment's real states (UI_BRIEF.md v4). */
function stepsFor(t: TransferView): Step[] {
  const steps: Step[] = [];
  if (t.quote) steps.push({ key: "fund", label: "Funded", reachedAt: "funding" });
  steps.push(
    { key: "approve", label: "Approved", reachedAt: "approving" },
    { key: "send", label: "Settled on Arc", reachedAt: "sending" },
    { key: "verify", label: "Receipt checked", reachedAt: "verifying" },
  );
  return steps;
}

function stepState(t: TransferView, step: Step, next: Step | undefined): StepState {
  if (t.status === "settled") return "done";
  if (t.status === "failed") {
    const provider = t.steps.find((s) => s.step === step.key);
    if (provider?.status === "failed") return "failed";
    return provider?.status === "complete" ? "done" : "waiting";
  }
  const now = ORDER.indexOf(t.status as (typeof ORDER)[number]);
  const at = ORDER.indexOf(step.reachedAt);
  const nextAt = next ? ORDER.indexOf(next.reachedAt) : ORDER.indexOf("settled");
  if (now >= nextAt) return "done";
  if (now >= at) return "active";
  return "waiting";
}

function who(t: TransferView): string {
  return t.recipients === 1 ? (t.legs[0]?.name ?? "1 person") : `${t.recipients} people`;
}

function Payment() {
  const { id } = useParams<{ id: string }>();
  const { me, refresh } = useMe();
  const [t, setT] = React.useState<TransferView | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await api<{ transfer: TransferView }>(`/api/transfers/${id}`);
        if (stopped) return;
        setT(res.transfer);
        setError(null);
        if (isFinal(res.transfer.status)) {
          void refresh();
          return;
        }
      } catch (err) {
        if (!stopped) setError(errorMessage(err));
      }
      timer = setTimeout(poll, 1200);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, refresh]);

  const moving = t !== null && !isFinal(t.status) && t.status !== "awaiting_confirmation";
  useFrameTone(moving ? "night" : "day");

  if (!t) {
    return error ? (
      <Notice tone="error" className="mt-8">
        {error}
      </Notice>
    ) : (
      <div aria-busy="true" aria-label="Loading payment" className="surface mt-8 h-96 motion-safe:animate-pulse" />
    );
  }

  if (moving) return <Sending t={t} error={error} />;
  if (t.status === "settled") return <Landed t={t} preview={me.mode === "preview"} />;
  return <NotSent t={t} />;
}

/** S7: the live screen. Each step lights only when the server says it happened. */
function Sending({ t, error }: { t: TransferView; error: string | null }) {
  const steps = stepsFor(t);
  return (
    <div className="enter pt-6" aria-live="polite">
      <h1 className="text-[2rem] leading-tight font-extrabold">Sending…</h1>
      <p className="mt-1 text-white/70">
        ${t.amount} to {who(t)}, settling on Arc.
      </p>
      <ol aria-label="Progress" className="surface-night mt-6 space-y-4 p-5">
        {steps.map((step, i) => {
          const state = stepState(t, step, steps[i + 1]);
          return (
            <li key={step.key} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  "h-4 w-4 shrink-0 rounded-full transition-colors duration-300",
                  state === "done" && "bg-primary",
                  state === "active" && "border-2 border-white bg-transparent motion-safe:animate-pulse",
                  state === "waiting" && "bg-white/25",
                  state === "failed" && "bg-destructive",
                )}
              />
              <span className={cn("font-medium", state === "waiting" && "text-white/55")}>
                {step.label}
                <span className="sr-only">: {state}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-sm text-white/60">Arc confirms in under a second once the payment is sent.</p>
      {error && (
        <p role="status" className="mt-4 text-sm text-white/80">
          {error} Retrying.
        </p>
      )}
    </div>
  );
}

/** S8: one card per person with what they got and what it was for. */
function Landed({ t, preview }: { t: TransferView; preview: boolean }) {
  const router = useRouter();
  const compact = t.legs.length > 6;
  const again = t.splitId ? `/send/${t.splitId}` : `/pay${t.recipients > 1 ? "?mode=many" : ""}`;
  const [picking, setPicking] = React.useState(false);
  const [shared, setShared] = React.useState<"copied" | "failed" | null>(null);
  const hasReceipts = t.legs.some((l) => l.receipt);

  /** One recipient: share theirs straight away. More: choose whose to share. */
  async function share() {
    const only = t.legs.length === 1 ? t.legs[0] : undefined;
    if (!only?.receipt) return setPicking(true);
    const result = await shareLink(only.receipt, receiptText(only));
    if (result === "copied" || result === "failed") setShared(result);
  }

  return (
    <div className="enter space-y-6 pt-6">
      <div>
        <h1 className="text-[2rem] leading-tight font-extrabold">Landed, divided.</h1>
        <p className="mt-1 text-muted-foreground">
          <CountUp value={t.amount} /> reached {t.recipients === 1 ? "1 wallet" : `${t.recipients} wallets`}.
        </p>
      </div>

      <ul className={cn(compact ? "surface divide-y divide-white/80 p-1" : "space-y-3")}>
        {t.legs.map((leg, i) => (
          <li key={i} className={cn(compact ? "flex items-center justify-between gap-3 px-4 py-3" : "surface p-4")}>
            {compact ? (
              <>
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: purposeFill(i) }} />
                  <span className="truncate font-medium">{leg.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="font-bold tabular-nums">${leg.amount}</span>
                  {leg.receipt && (
                    <Link
                      href={leg.receipt}
                      aria-label={`View ${leg.name}'s receipt`}
                      className="-my-2 -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-primary hover:bg-white/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <ReceiptText className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="block truncate text-sm text-muted-foreground">
                  {leg.name} · {leg.purpose}
                </span>
                <span className="figure mt-1 block text-[1.75rem] leading-none">${leg.amount}</span>
                <span className="mt-3 flex items-center justify-between gap-3">
                  <span aria-hidden="true" className="block h-1.5 w-14 rounded-full" style={{ backgroundColor: purposeFill(i) }} />
                  {leg.receipt && (
                    <Link
                      href={leg.receipt}
                      className="-my-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <ReceiptText className="h-4 w-4" aria-hidden="true" />
                      View receipt
                      <span className="sr-only"> for {leg.name}</span>
                    </Link>
                  )}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>

      <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-primary">
        {t.explorerUrl && (
          <a href={t.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline">
            View on Arc explorer
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        {t.explorerUrl && hasReceipts && <span aria-hidden="true">·</span>}
        {hasReceipts && (
          <button type="button" onClick={() => void share()} className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline">
            {shared === "copied" ? "Receipt link copied" : t.legs.length === 1 ? "Share receipt" : "Share a receipt"}
            <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </p>
      {shared === "failed" && t.legs[0]?.receipt && (
        <div role="status" className="-mt-3 text-sm">
          <span className="font-semibold">Copy this link to share it:</span>
          <ManualLink path={t.legs[0].receipt} />
        </div>
      )}
      {!t.explorerUrl && preview && (
        <p className="text-sm text-muted-foreground">Preview mode: these receipts are simulated, so there is no explorer link.</p>
      )}
      <ShareReceipts legs={t.legs} open={picking} onClose={() => setPicking(false)} />

      <div className="space-y-3">
        <Button className="w-full" onClick={() => router.push("/home")}>
          Done
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => router.push(again)}>
          Send again
        </Button>
      </div>
    </div>
  );
}

/** A payment that didn't go: what happened, and where the money is. */
function NotSent({ t }: { t: TransferView }) {
  const router = useRouter();
  const steps = stepsFor(t);
  return (
    <div className="enter space-y-6 pt-6">
      <div>
        <h1 className="text-[2rem] leading-tight font-extrabold">{t.status === "failed" ? "Not sent" : "Not started"}</h1>
        <p className="mt-1 text-muted-foreground">
          ${t.amount} to {who(t)}
        </p>
      </div>
      {t.error && (
        <Notice tone="error" className="flex items-start gap-2">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t.error}
        </Notice>
      )}
      <ol aria-label="Progress" className="surface space-y-3 p-5">
        {steps.map((step, i) => {
          const state = stepState(t, step, steps[i + 1]);
          return (
            <li key={step.key} className="flex items-center gap-3 text-sm">
              <span
                aria-hidden="true"
                className={cn(
                  "h-3.5 w-3.5 shrink-0 rounded-full",
                  state === "done" && "bg-primary",
                  state === "failed" && "bg-destructive",
                  (state === "waiting" || state === "active") && "bg-muted-foreground/25",
                )}
              />
              <span className={cn(state === "waiting" && "text-muted-foreground")}>
                {step.label}
                <span className="sr-only">: {state}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="space-y-3">
        {t.kind === "pay" && (
          <Link
            href={`/pay${t.recipients > 1 ? "?mode=many" : ""}`}
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground hover:bg-primary-deep focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Back to Pay
          </Link>
        )}
        <Button variant="secondary" className="w-full" onClick={() => router.push("/home")}>
          Home
        </Button>
      </div>
    </div>
  );
}
