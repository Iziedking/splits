"use client";

import { Plus, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { BackLink } from "@/components/app/back-link";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { ConfirmDialog, type Proof } from "@/components/app/confirm-dialog";
import { PurposeDot } from "@/components/app/purpose-dot";
import { Ribbon } from "@/components/app/ribbon";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Field, inputClass, Notice } from "@/components/ui/field";
import { api, errorMessage, type ActionView, type SplitView } from "@/lib/api";
import { percentToBps } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function NewSplitPage() {
  return (
    <AppFrame>
      <NewSplit />
    </AppFrame>
  );
}

type LegDraft = { key: number; name: string; email: string; purpose: string; kind: "percent" | "fixed"; value: string };

const EXAMPLES = [
  { name: "Landlord", email: "landlord@example.com", purpose: "rent", percent: "40" },
  { name: "School", email: "bursar@example.com", purpose: "school fees", percent: "35" },
  { name: "Sister", email: "sister@example.com", purpose: "upkeep", percent: "25" },
];

/** Saved splits stay human-sized; one-off payouts to many people go through Pay instead. */
const MAX_SPLIT_LEGS = 20;

let nextKey = 1;
const blankLeg = (): LegDraft => ({ key: nextKey++, name: "", email: "", purpose: "", kind: "percent", value: "" });

/** How wide a recipient's block is in the live ribbon. Fixed amounts count as their dollar value. */
function legWeight(leg: LegDraft): number {
  const n = Number(leg.value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function NewSplit() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { me } = useMe();
  const [name, setName] = React.useState("");
  const [legs, setLegs] = React.useState<LegDraft[]>(() => [blankLeg(), blankLeg()]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<{ action: ActionView; split: SplitView } | null>(null);

  // Starting points from Home. Read after mount so the page needs no suspense boundary.
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("template") !== "team") return;
    setName("Team revenue share");
    setLegs([
      { ...blankLeg(), name: "Partner A", purpose: "revenue share", value: "50" },
      { ...blankLeg(), name: "Partner B", purpose: "revenue share", value: "50" },
    ]);
  }, []);

  const percentLegs = legs.filter((l) => l.kind === "percent");
  const totalBps = percentLegs.reduce((sum, l) => sum + (percentToBps(l.value) ?? 0), 0);
  // Under 100% is fine: whatever isn't allocated simply isn't sent. Over 100% never is.
  const sharesOk = percentLegs.length === 0 || (totalBps > 0 && totalBps <= 10_000);
  /** Empty required fields, so the disabled Review button can say what it waits for. */
  const missing = (name.trim() ? 0 : 1) + legs.reduce((n, l) => n + [l.name, l.email, l.purpose, l.value].filter((v) => !v.trim()).length, 0);
  const complete = missing === 0;

  function update(key: number, patch: Partial<LegDraft>) {
    setLegs((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function review(e: React.FormEvent) {
    e.preventDefault();
    if (!sharesOk) {
      setError(`Percentages add up to ${totalBps / 100}%. They can be at most 100%.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ split: SplitView; action: ActionView }>("/api/splits", {
        body: {
          name,
          legs: legs.map((l) => ({
            name: l.name,
            to: { type: "email", email: l.email },
            purpose: l.purpose,
            amount: l.kind === "percent" ? { type: "percent", percent: Number(l.value) } : { type: "fixed", usdc: l.value },
          })),
        },
      });
      setPending(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(proof: Proof) {
    if (!pending) return;
    await api("/api/splits/confirm", { body: { actionId: pending.action.id, ...proof } });
    router.replace("/home");
  }

  return (
    <div className="enter pt-4">
      <BackLink href="/home" />
      <h1 className="mt-1 text-title leading-tight font-extrabold">Build the split</h1>
      <p className="mt-2 text-lg text-muted-foreground">
        Who gets paid, and what for. Recipients don't need an app. Their email is enough.
      </p>

      <form onSubmit={review} className="mt-8 space-y-6">
        <Field label="Split name" placeholder="Family in Lagos" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />

        <div className="surface sticky top-3 z-10 p-4">
          <Ribbon height={8} parts={legs.map((l) => ({ label: l.name || `Recipient ${legs.indexOf(l) + 1}`, weight: legWeight(l) }))} />
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-hidden="true">
            {legs.map((l, i) => (
              <li key={l.key} className="flex items-center gap-1.5">
                <PurposeDot index={i} />
                {l.purpose || l.name || `Recipient ${i + 1}`}
                <span className="font-semibold tabular-nums">
                  {l.value ? (l.kind === "percent" ? `${l.value}%` : `$${l.value}`) : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <fieldset className="space-y-4">
          <legend className="mb-2 text-lg font-bold">Recipients</legend>
          {legs.map((leg, i) => (
            <motion.fieldset
              key={leg.key}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="surface p-5"
            >
              <legend className="sr-only">
                Recipient {i + 1}
                {leg.name.trim() && `, ${leg.name.trim()}`}
              </legend>
              <div className="mb-4 flex items-center justify-between">
                <div aria-hidden="true" className="flex min-w-0 items-center gap-2.5 text-ui font-bold">
                  <PurposeDot index={i} />
                  <span className="truncate">{leg.name || `Recipient ${i + 1}`}</span>
                  {leg.value && (
                    <span className="ml-1 text-lg font-extrabold tabular-nums">
                      {leg.kind === "percent" ? `${leg.value}%` : `$${leg.value}`}
                    </span>
                  )}
                </div>
                {legs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLegs((current) => current.filter((l) => l.key !== leg.key))}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    aria-label={`Remove recipient ${i + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="grid gap-3">
                <Field label="Name" placeholder={EXAMPLES[i % EXAMPLES.length]!.name} value={leg.name} onChange={(e) => update(leg.key, { name: e.target.value })} maxLength={40} />
                <Field label="Email" type="email" placeholder={EXAMPLES[i % EXAMPLES.length]!.email} value={leg.email} onChange={(e) => update(leg.key, { email: e.target.value })} />
                <Field label="What it's for" placeholder={EXAMPLES[i % EXAMPLES.length]!.purpose} value={leg.purpose} onChange={(e) => update(leg.key, { purpose: e.target.value })} maxLength={31} hint="Saved with every payment as its receipt" />
                <div>
                  <span id={`amount-${leg.key}`} className="mb-1.5 block text-sm font-medium">
                    Amount
                  </span>
                  <div className="flex gap-2">
                    <Segmented
                      kind="radio"
                      labelledBy={`amount-${leg.key}`}
                      className="shrink-0"
                      options={[
                        { value: "percent", label: "%" },
                        { value: "fixed", label: "$" },
                      ]}
                      value={leg.kind}
                      onChange={(kind) => update(leg.key, { kind, value: "" })}
                    />
                    <input
                      aria-label={leg.kind === "percent" ? "Percentage" : "Fixed amount in dollars"}
                      className={inputClass}
                      inputMode="decimal"
                      placeholder={leg.kind === "percent" ? EXAMPLES[i % EXAMPLES.length]!.percent : "150.00"}
                      value={leg.value}
                      onChange={(e) => update(leg.key, { value: e.target.value.replace(/[^\d.]/g, "") })}
                    />
                  </div>
                </div>
              </div>
            </motion.fieldset>
          ))}
          {legs.length < MAX_SPLIT_LEGS && (
            <Button type="button" variant="secondary" className="w-full" onClick={() => setLegs((current) => [...current, blankLeg()])}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add recipient
            </Button>
          )}
        </fieldset>

        {percentLegs.length > 0 && (
          <p role="status" className={cn("text-sm font-semibold", sharesOk ? "text-primary-text" : "text-muted-foreground")}>
            {totalBps > 10_000
              ? `${totalBps / 100}% allocated. Bring it down to 100% or less.`
              : totalBps === 10_000
                ? "100% allocated."
                : `${totalBps / 100}% allocated. The other ${(10_000 - totalBps) / 100}% isn't sent.`}
            {legs.some((l) => l.kind === "fixed") && " Fixed amounts are paid first; percentages share the rest."}
          </p>
        )}

        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" busy={busy} disabled={!complete} aria-describedby={complete ? undefined : "split-missing"}>
          Review
        </Button>
        {!complete && (
          <p id="split-missing" className="text-center text-sm text-muted-foreground">
            Fill in {missing === 1 ? "1 more field" : `${missing} more fields`} to review.
          </p>
        )}
      </form>

      <ConfirmDialog
        actionId={pending?.action.id ?? null}
        title="Approve this split"
        hasPasskey={me.user.hasPasskey}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      >
        {pending && (
          <div className="space-y-3">
            <p className="display-face text-xl font-bold">{pending.split.name}</p>
            <Ribbon parts={pending.split.legs.map((l) => ({ label: l.name, weight: l.percent ?? Number(l.fixed ?? 0) }))} />
            <ul className="space-y-1.5 pt-1 text-sm">
              {pending.split.legs.map((l, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span className="flex items-center gap-2">
                    <PurposeDot index={i} />
                    {l.name} <span className="text-muted-foreground">for {l.purpose}</span>
                  </span>
                  <span className="font-medium tabular-nums">{l.percent !== null ? `${l.percent}%` : `$${l.fixed}`}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Every payment through this split gets its own receipt.</p>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
