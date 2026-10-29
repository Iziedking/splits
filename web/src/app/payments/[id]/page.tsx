"use client";

import { CircleAlert } from "lucide-react";
import { useParams } from "next/navigation";
import * as React from "react";
import { AppFrame, useFrameTone, useMe } from "@/components/app/app-frame";
import { Loader } from "@/components/app/loader";
import { Landed } from "@/components/app/landed";
import { StepList, type StepState } from "@/components/app/step-list";
import { ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, errorMessage, type TransferView } from "@/lib/api";
import { isFinal } from "@/lib/format";

export default function PaymentPage() {
  return (
    <AppFrame wide>
      <Payment />
    </AppFrame>
  );
}

const ORDER = ["confirmed", "funding", "approving", "sending", "verifying", "settled"] as const;
type Step = { key: string; label: string; reachedAt: (typeof ORDER)[number] };

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

const listed = (t: TransferView, steps: Step[]) => steps.map((step, i) => ({ key: step.key, label: step.label, state: stepState(t, step, steps[i + 1]) }));

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
      <Loader label="Loading payment" />
    );
  }

  // The settled view uses the width (UI_BRIEF.md v5); in-flight and failed stay a readable column.
  if (moving) {
    return (
      <div className="lg:max-w-xl">
        <Sending t={t} error={error} />
      </div>
    );
  }
  if (t.status === "settled") {
    const again = t.splitId ? `/send/${t.splitId}` : `/pay${t.recipients > 1 ? "?mode=many" : ""}`;
    return (
      <Landed
        t={t}
        preview={me.mode === "preview"}
        returnTo={`/payments/${t.id}`}
        actions={
          <>
            <ButtonLink href="/home" className="w-full">
              Done
            </ButtonLink>
            <ButtonLink href={again} variant="secondary" className="w-full">
              Send again
            </ButtonLink>
          </>
        }
      />
    );
  }
  return (
    <div className="lg:max-w-xl">
      <NotSent t={t} />
    </div>
  );
}

/** S7: the live screen. Each step lights only when the server says it happened. */
function Sending({ t, error }: { t: TransferView; error: string | null }) {
  const steps = stepsFor(t);
  return (
    <div className="enter pt-6" aria-live="polite">
      <h1 className="text-title leading-tight font-extrabold">Sending…</h1>
      <p className="mt-1 text-white/70">
        ${t.amount} to {who(t)}, settling on Arc.
      </p>
      <StepList tone="night" className="surface-night mt-6 p-5" steps={listed(t, steps)} />
      <p className="mt-4 text-sm text-white/60">Arc confirms in under a second once the payment is sent.</p>
      {error && (
        <p role="status" className="mt-4 text-sm text-white/80">
          {error} Retrying.
        </p>
      )}
    </div>
  );
}

/** A payment that didn't go: what happened, and where the money is. */
function NotSent({ t }: { t: TransferView }) {
  const steps = stepsFor(t);
  return (
    <div className="enter space-y-6 pt-6">
      <div>
        <h1 className="text-title leading-tight font-extrabold">{t.status === "failed" ? "Not sent" : "Not started"}</h1>
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
      <StepList className="surface p-5" steps={listed(t, steps).map((s) => (s.state === "active" ? { ...s, state: "waiting" as const } : s))} />
      <div className="space-y-3">
        {t.kind === "pay" && (
          <ButtonLink href={`/pay${t.recipients > 1 ? "?mode=many" : ""}`} className="w-full">
            Back to Pay
          </ButtonLink>
        )}
        <ButtonLink href="/home" variant="secondary" className="w-full">
          Home
        </ButtonLink>
      </div>
    </div>
  );
}
