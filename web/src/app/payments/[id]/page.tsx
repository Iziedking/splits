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
import { api, ApiError, errorMessage, type TransferView } from "@/lib/api";
import { isFinal, TRACKER_STEP } from "@/lib/format";

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
  if (t.quote) steps.push({ key: "fund", label: TRACKER_STEP.fund, reachedAt: "funding" });
  steps.push(
    { key: "approve", label: TRACKER_STEP.approve, reachedAt: "approving" },
    { key: "send", label: TRACKER_STEP.send, reachedAt: "sending" },
    { key: "verify", label: TRACKER_STEP.verify, reachedAt: "verifying" },
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
  /** The payment isn't this person's, or doesn't exist: nothing to wait for. */
  const [missing, setMissing] = React.useState(false);

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
        if (stopped) return;
        if (err instanceof ApiError && err.status === 404) {
          setMissing(true);
          return;
        }
        setError(errorMessage(err));
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

  if (missing) {
    return (
      <div className="enter space-y-3 pt-6 lg:max-w-xl">
        <h1 className="text-title leading-tight font-extrabold">We can&apos;t find this payment</h1>
        <p className="text-muted-foreground">The link may be cut short, or the payment belongs to another account. Your payments are all in History.</p>
        <div className="grid gap-3 pt-3 sm:grid-cols-2">
          <ButtonLink href="/home">Home</ButtonLink>
          <ButtonLink href="/history" variant="secondary">
            History
          </ButtonLink>
        </div>
      </div>
    );
  }
  if (!t) {
    return (
      <>
        <Loader label="Loading payment" />
        {error && (
          <Notice tone="error" className="mt-4">
            {error} Retrying.
          </Notice>
        )}
      </>
    );
  }

  return (
    <>
      <p role="status" className="sr-only">
        {spokenStatus(t)}
      </p>
      <PaymentState t={t} error={error} preview={me.mode === "preview"} moving={moving} />
    </>
  );
}

/** The page's one live sentence: where the payment is now. */
function spokenStatus(t: TransferView): string {
  if (t.status === "settled") return `Paid. $${t.amount} reached ${who(t)}.`;
  if (t.status === "failed") return "Not sent.";
  if (t.status === "awaiting_confirmation") return "Not started.";
  const steps = stepsFor(t);
  const now = steps.find((s, i) => stepState(t, s, steps[i + 1]) === "active");
  return now ? `${now.label}: in progress.` : "Sending.";
}

function PaymentState({ t, error, preview, moving }: { t: TransferView; error: string | null; preview: boolean; moving: boolean }) {
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
        preview={preview}
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
    <div className="enter pt-6">
      <h1 className="text-title leading-tight font-extrabold">Sending…</h1>
      <p className="mt-1 text-white/70">
        ${t.amount} to {who(t)}, on its way.
      </p>
      <StepList tone="night" className="surface-night mt-6 p-5" steps={listed(t, steps)} />
      <p className="mt-4 text-sm text-white/60">It usually lands within a few seconds.</p>
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
