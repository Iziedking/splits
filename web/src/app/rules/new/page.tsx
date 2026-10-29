"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { BackLink } from "@/components/app/back-link";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { ConfirmDialog, type Proof } from "@/components/app/confirm-dialog";
import { PurposeDot } from "@/components/app/purpose-dot";
import { Ribbon } from "@/components/app/ribbon";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { api, errorMessage, type ActionView, type SplitView, type WalletView } from "@/lib/api";

export default function NewRulePage() {
  return (
    <AppFrame>
      <NewRule />
    </AppFrame>
  );
}

/** A receiver's own split: part of every payment that lands in their wallet goes to a pocket. */
function NewRule() {
  const router = useRouter();
  const { me, refresh } = useMe();
  const main = me.wallets.find((w) => w.kind === "main");
  const [pocketName, setPocketName] = React.useState("Savings");
  const [percent, setPercent] = React.useState(30);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<{ action: ActionView; split: SplitView } | null>(null);

  async function review(e: React.FormEvent) {
    e.preventDefault();
    if (!main) return;
    setBusy(true);
    setError(null);
    try {
      let pocket = me.wallets.find((w) => w.kind === "pocket" && w.label.toLowerCase() === pocketName.trim().toLowerCase());
      if (!pocket) {
        pocket = (await api<{ wallet: WalletView }>("/api/pockets", { body: { label: pocketName } })).wallet;
        await refresh();
      }
      const res = await api<{ split: SplitView; action: ActionView }>("/api/splits", {
        body: {
          name: `Save ${percent}% of what I receive`,
          autoForWalletId: main.id,
          legs: [
            { name: pocket.label, to: { type: "wallet", walletId: pocket.id }, amount: { type: "percent", percent }, purpose: "savings" },
            { name: "Spending", to: { type: "wallet", walletId: main.id }, amount: { type: "percent", percent: 100 - percent }, purpose: "spending" },
          ],
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
      <h1 className="mt-1 text-title leading-tight font-extrabold">Split money you receive</h1>
      <form onSubmit={review} className="surface mt-6 space-y-6 p-6">
        <div>
          <p className="figure text-7xl">{percent}%</p>
          <p className="mt-2 text-muted-foreground">
            of every payment that reaches your wallet goes straight to {pocketName.trim() || "your pocket"}. The rest
            stays for spending.
          </p>
        </div>
        <div>
          <Ribbon
            height={18}
            parts={[
              { label: pocketName.trim() || "Pocket", weight: percent },
              { label: "Spending", weight: 100 - percent },
            ]}
          />
          <div className="mt-2 flex justify-between text-sm font-semibold" aria-hidden="true">
            <span className="flex items-center gap-1.5">
              <PurposeDot index={0} />
              {pocketName.trim() || "Pocket"}
            </span>
            <span className="flex items-center gap-1.5">
              Spending
              <PurposeDot index={1} />
            </span>
          </div>
        </div>
        <div>
          <label htmlFor="save-percent" className="mb-1.5 block text-sm font-medium">
            How much to put aside
          </label>
          <input
            id="save-percent"
            type="range"
            min={5}
            max={90}
            step={5}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            aria-valuetext={`${percent} percent`}
            className="h-11 w-full accent-primary"
          />
        </div>
        {me.wallets.some((w) => w.kind === "pocket") && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Your pockets">
            {me.wallets
              .filter((w) => w.kind === "pocket")
              .map((w) => (
                <button
                  key={w.id}
                  type="button"
                  aria-pressed={pocketName.trim().toLowerCase() === w.label.toLowerCase()}
                  onClick={() => setPocketName(w.label)}
                  className="min-h-11 rounded-full bg-white/80 px-4 text-sm font-semibold ring-1 ring-border aria-pressed:bg-primary-fill aria-pressed:text-primary-foreground aria-pressed:ring-primary-fill focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {w.earn ? "Earning pocket" : w.label}
                </button>
              ))}
          </div>
        )}
        <Field label="Pocket name" value={pocketName} onChange={(e) => setPocketName(e.target.value)} maxLength={40} />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" busy={busy} disabled={!pocketName.trim()}>
          Review and approve
        </Button>
        <p className="text-xs text-muted-foreground">
          You approve this once. After that it runs on its own, and payments under $0.10 are left alone.
        </p>
      </form>

      <ConfirmDialog
        actionId={pending?.action.id ?? null}
        title="Approve automatic split"
        hasPasskey={me.user.hasPasskey}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      >
        <p className="text-sm">
          From now on, {percent}% of money you receive moves to {pocketName.trim()} and {100 - percent}% stays for spending.
        </p>
      </ConfirmDialog>
    </div>
  );
}
