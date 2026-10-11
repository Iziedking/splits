"use client";

import { Check, CircleAlert, ExternalLink } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { CountUp } from "@/components/app/count-up";
import { SplitStream, type StreamStage } from "@/components/app/split-stream";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, errorMessage, type TransferView } from "@/lib/api";
import { isFinal, STATUS_LABEL } from "@/lib/format";
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

/** The stream follows the server: funding and approval fill the trunk, paying out draws the branches. */
function streamStage(status: string): StreamStage {
  if (status === "settled") return "done";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "sending" || status === "verifying") return "branches";
  return "trunk";
}

function Payment() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const reduce = useReducedMotion();
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
      <Notice tone="error" className="mx-auto mt-8 max-w-lg">{error}</Notice>
    ) : (
      <div aria-busy="true" aria-label="Loading payment" className="mx-auto mt-8 h-[28rem] max-w-lg rounded-[20px] bg-muted motion-safe:animate-pulse" />
    );
  }

  const steps = stepsFor(t);
  const settled = t.status === "settled";
  const failed = t.status === "failed";

  return (
    <div className="enter mx-auto max-w-lg pt-2">
      <Link href="/home" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
        Home
      </Link>

      <div className="surface mt-1 overflow-hidden">
        <div className="p-6 pb-2">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-[15px] font-medium text-muted-foreground">
              {t.kind === "auto" ? "Automatic split" : "Payment"}
            </h1>
            <AnimatePresence mode="wait">
              <motion.p
                key={t.status}
                role="status"
                initial={reduce ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: 6 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold",
                  settled && "bg-success text-white",
                  failed && "bg-destructive text-white",
                  !settled && !failed && "bg-purpose-1 text-primary",
                )}
              >
                {settled && <Check className="h-4 w-4" aria-hidden="true" />}
                {failed && <CircleAlert className="h-4 w-4" aria-hidden="true" />}
                {STATUS_LABEL[t.status]}
              </motion.p>
            </AnimatePresence>
          </div>
          <p className="figure mt-2 text-6xl">
            <CountUp value={t.amount} />
          </p>
          {t.quote && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t.quote.currency} {t.quote.fiat} at {t.quote.rate} USDC each, simulated card
            </p>
          )}
        </div>

        <SplitStream
          branches={t.legs.map((l) => ({ label: l.name, weight: Number(l.amount) }))}
          stage={streamStage(t.status)}
          className="w-full px-2 text-foreground"
        />

        <div className="space-y-6 p-6 pt-2">
          {failed && t.error && <Notice tone="error">{t.error}</Notice>}

          <ul className="space-y-3">
            {t.legs.map((leg, i) => (
              <li key={i} className="flex items-center justify-between gap-4">
                <span className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: purposeFill(i) }} />
                  <span className="truncate font-semibold">{leg.name}</span>
                  <span className="truncate text-sm text-muted-foreground">{leg.purpose}</span>
                </span>
                <span className="flex items-center gap-2 font-semibold tabular-nums">
                  ${leg.amount}
                  <AnimatePresence>
                    {settled && (
                      <motion.span
                        initial={reduce ? false : { scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={reduce ? { duration: 0 } : { delay: 0.15 + i * 0.12, type: "spring", stiffness: 500, damping: 22 }}
                        className="flex h-5 w-5 items-center justify-center rounded-full bg-success text-white"
                      >
                        <Check className="h-3.5 w-3.5" aria-label="received" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              </li>
            ))}
          </ul>

          <ol className="space-y-2.5 border-t border-border pt-5" aria-label="Progress">
            {steps.map((step, i) => {
              const state = stepState(t, step, steps[i + 1]);
              return (
                <li key={step.key} className="flex items-center gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
                      state === "done" && "bg-primary text-primary-foreground",
                      state === "active" && "bg-purpose-1 text-primary motion-safe:animate-pulse",
                      state === "failed" && "bg-destructive text-white",
                      state === "waiting" && "bg-secondary",
                    )}
                  >
                    {state === "done" && <Check className="h-3.5 w-3.5" />}
                    {state === "failed" && <CircleAlert className="h-3.5 w-3.5" />}
                  </span>
                  <span className={cn(state === "waiting" ? "text-muted-foreground" : "font-medium")}>
                    {step.label}
                    <span className="sr-only">: {state}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          {t.txHash && (
            <div className="rounded-2xl bg-secondary/70 p-4 text-sm">
              <p className="font-semibold">Receipt on Arc</p>
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
                  {t.txHash}
                  {me.mode === "preview" && " (simulated in preview)"}
                </p>
              )}
            </div>
          )}

          {isFinal(t.status) && (
            <Button variant={settled ? "primary" : "secondary"} className="w-full" onClick={() => router.push("/home")}>
              Done
            </Button>
          )}
          {error && <Notice tone="error">{error} Retrying.</Notice>}
        </div>
      </div>
    </div>
  );
}
