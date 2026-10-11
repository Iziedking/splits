"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { ConfirmDialog, type Proof } from "@/components/app/confirm-dialog";
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

let nextKey = 1;
const blankLeg = (): LegDraft => ({ key: nextKey++, name: "", email: "", purpose: "", kind: "percent", value: "" });

function NewSplit() {
  const router = useRouter();
  const { me } = useMe();
  const [name, setName] = React.useState("");
  const [legs, setLegs] = React.useState<LegDraft[]>(() => [blankLeg(), blankLeg()]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<{ action: ActionView; split: SplitView } | null>(null);

  const percentLegs = legs.filter((l) => l.kind === "percent");
  const totalBps = percentLegs.reduce((sum, l) => sum + (percentToBps(l.value) ?? 0), 0);
  const sharesOk = percentLegs.length === 0 || totalBps === 10_000;
  const complete = name.trim() !== "" && legs.every((l) => l.name.trim() && l.email.trim() && l.purpose.trim() && l.value.trim());

  function update(key: number, patch: Partial<LegDraft>) {
    setLegs((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function review(e: React.FormEvent) {
    e.preventDefault();
    if (!sharesOk) {
      setError(`Percentages add up to ${totalBps / 100}%. They need to make 100%.`);
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
    <div className="enter mx-auto max-w-2xl pt-4">
      <Link href="/home" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
        Back
      </Link>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">New split</h1>
      <p className="mt-2 text-muted-foreground">
        Who gets paid, and what for. Recipients don't need an app: their email becomes their wallet.
      </p>

      <form onSubmit={review} className="mt-8 space-y-6">
        <Field label="Split name" placeholder="Family in Lagos" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />

        <fieldset className="space-y-4">
          <legend className="mb-2 text-sm font-medium">Recipients</legend>
          {legs.map((leg, i) => (
            <fieldset key={leg.key} className="rounded-2xl bg-muted/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <legend className="float-left text-sm font-semibold">Recipient {i + 1}</legend>
                {legs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLegs((current) => current.filter((l) => l.key !== leg.key))}
                    className="-m-2 rounded-full p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    aria-label={`Remove recipient ${i + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" placeholder={EXAMPLES[i % EXAMPLES.length]!.name} value={leg.name} onChange={(e) => update(leg.key, { name: e.target.value })} maxLength={40} />
                <Field label="Email" type="email" placeholder={EXAMPLES[i % EXAMPLES.length]!.email} value={leg.email} onChange={(e) => update(leg.key, { email: e.target.value })} />
                <Field label="What it's for" placeholder={EXAMPLES[i % EXAMPLES.length]!.purpose} value={leg.purpose} onChange={(e) => update(leg.key, { purpose: e.target.value })} maxLength={31} hint="Saved with every payment as its receipt" />
                <div>
                  <span id={`amount-${leg.key}`} className="mb-1.5 block text-sm font-medium">
                    Amount
                  </span>
                  <div className="flex gap-2">
                    <div role="radiogroup" aria-labelledby={`amount-${leg.key}`} className="flex rounded-xl bg-background p-1 ring-1 ring-input">
                      {(["percent", "fixed"] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          role="radio"
                          aria-checked={leg.kind === kind}
                          onClick={() => update(leg.key, { kind, value: "" })}
                          className={cn(
                            "min-h-9 rounded-lg px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            leg.kind === kind ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                          )}
                        >
                          {kind === "percent" ? "%" : "$"}
                        </button>
                      ))}
                    </div>
                    <input
                      aria-label={leg.kind === "percent" ? "Percentage" : "Fixed amount in USDC"}
                      className={inputClass}
                      inputMode="decimal"
                      placeholder={leg.kind === "percent" ? EXAMPLES[i % EXAMPLES.length]!.percent : "150.00"}
                      value={leg.value}
                      onChange={(e) => update(leg.key, { value: e.target.value.replace(/[^\d.]/g, "") })}
                    />
                  </div>
                </div>
              </div>
            </fieldset>
          ))}
          {legs.length < 10 && (
            <Button type="button" variant="secondary" onClick={() => setLegs((current) => [...current, blankLeg()])}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add recipient
            </Button>
          )}
        </fieldset>

        {percentLegs.length > 0 && (
          <p role="status" className={cn("text-sm font-medium", sharesOk ? "text-emerald-700" : "text-muted-foreground")}>
            {sharesOk ? "Percentages make 100%." : `Percentages make ${totalBps / 100}% of 100%.`}
            {legs.some((l) => l.kind === "fixed") && " Fixed amounts are paid first; percentages share the rest."}
          </p>
        )}

        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full sm:w-auto" busy={busy} disabled={!complete}>
          Review and approve
        </Button>
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
            <p className="font-semibold">{pending.split.name}</p>
            <ul className="space-y-1 text-sm">
              {pending.split.legs.map((l, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span>
                    {l.name} <span className="text-muted-foreground">for {l.purpose}</span>
                  </span>
                  <span className="font-medium tabular-nums">{l.percent !== null ? `${l.percent}%` : `$${l.fixed}`}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">This is saved on Arc, so every payment through it is checkable.</p>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
