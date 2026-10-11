"use client";

import { Check, CircleAlert, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, errorMessage, type TransferView } from "@/lib/api";
import { isFinal, STATUS_LABEL } from "@/lib/format";
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

function stepsFor(t: TransferView): Step[] {
  const steps: Step[] = [];
  if (t.quote) steps.push({ key: "fund", label: "Card top-up (simulated card)", reachedAt: "funding" });
  steps.push(
    { key: "approve", label: "Allow the split to move this amount", reachedAt: "approving" },
    { key: "send", label: "Split and pay out on Arc", reachedAt: "sending" },
    { key: "verify", label: "Check the onchain receipt", reachedAt: "verifying" },
  );
  return steps;
}

function stepState(t: TransferView, step: Step, next: Step | undefined): "done" | "active" | "waiting" | "failed" {
  if (t.status === "settled") return "done";
  const at = ORDER.indexOf(step.reachedAt);
  const nextAt = next ? ORDER.indexOf(next.reachedAt) : ORDER.indexOf("settled");
  const now = ORDER.indexOf(t.status as (typeof ORDER)[number]);
  if (t.status === "failed") {
    const provider = t.steps.find((s) => s.step === step.key);
    if (provider?.status === "failed") return "failed";
    return provider?.status === "complete" ? "done" : "waiting";
  }
  if (now >= nextAt) return "done";
  if (now >= at) return "active";
  return "waiting";
}

function Payment() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
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

  if (!t) {
    return error ? (
      <Notice tone="error" className="mx-auto mt-8 max-w-md">{error}</Notice>
    ) : (
      <div aria-busy="true" aria-label="Loading payment" className="mx-auto mt-8 h-96 max-w-md rounded-2xl bg-muted/60 motion-safe:animate-pulse" />
    );
  }

  const steps = stepsFor(t);
  const settled = t.status === "settled";
  const failed = t.status === "failed";

  return (
    <div className="enter mx-auto max-w-md pt-4">
      <Link href="/home" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
        Home
      </Link>
      <div className="mt-2 rounded-2xl bg-card p-6 shadow-lg">
        <h1 className="text-lg font-medium text-muted-foreground">
          {t.kind === "auto" ? "Automatic split" : "Payment"}
        </h1>
        <p className="mt-2 text-5xl font-bold tracking-tight tabular-nums">${t.amount}</p>
        {t.quote && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t.quote.currency} {t.quote.fiat} at {t.quote.rate} USDC each (simulated card)
          </p>
        )}

        <p
          role="status"
          className={cn(
            "mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold",
            settled && "bg-emerald-50 text-emerald-800",
            failed && "bg-destructive/10 text-destructive",
            !settled && !failed && "bg-amber-50 text-amber-900",
          )}
        >
          {settled ? <Check className="h-4 w-4" aria-hidden="true" /> : failed ? <CircleAlert className="h-4 w-4" aria-hidden="true" /> : null}
          {STATUS_LABEL[t.status]}
        </p>

        {failed && t.error && <Notice tone="error" className="mt-4">{t.error}</Notice>}

        <ol className="mt-6 space-y-3" aria-label="Progress">
          {steps.map((step, i) => {
            const state = stepState(t, step, steps[i + 1]);
            return (
              <li key={step.key} className="flex items-center gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                    state === "done" && "border-primary bg-primary text-primary-foreground",
                    state === "active" && "border-amber-500 motion-safe:animate-pulse",
                    state === "failed" && "border-destructive bg-destructive text-white",
                    state === "waiting" && "border-border",
                  )}
                >
                  {state === "done" && <Check className="h-3.5 w-3.5" />}
                  {state === "failed" && <CircleAlert className="h-3.5 w-3.5" />}
                </span>
                <span className={cn(state === "waiting" && "text-muted-foreground")}>
                  {step.label}
                  <span className="sr-only">: {state}</span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-6 rounded-xl bg-muted/50 p-4">
          <p className="text-sm font-semibold">{settled ? "Delivered to" : "Going to"}</p>
          <ul className="mt-2 space-y-2">
            {t.legs.map((leg, i) => (
              <li key={i} className="flex justify-between gap-4 text-sm">
                <span>
                  {leg.name} <span className="text-muted-foreground">for {leg.purpose}</span>
                </span>
                <span className="flex items-center gap-1.5 font-medium tabular-nums">
                  ${leg.amount}
                  {settled && <Check className="h-4 w-4 text-emerald-700" aria-label="received" />}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {t.txHash && (
          <div className="mt-4 text-sm">
            <p className="text-muted-foreground">Receipt</p>
            {t.explorerUrl ? (
              <a
                href={t.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 font-mono text-xs break-all underline underline-offset-4"
              >
                {t.txHash}
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </a>
            ) : (
              <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
                {t.txHash} {me.mode === "preview" && "(simulated in preview)"}
              </p>
            )}
          </div>
        )}

        {isFinal(t.status) && (
          <Button variant={settled ? "primary" : "secondary"} className="mt-6 w-full" onClick={() => router.push("/home")}>
            Done
          </Button>
        )}
        {error && <Notice tone="error" className="mt-4">{error} We'll keep trying.</Notice>}
      </div>
    </div>
  );
}
