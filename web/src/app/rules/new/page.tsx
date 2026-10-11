"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { ConfirmDialog, type Proof } from "@/components/app/confirm-dialog";
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
    <div className="enter mx-auto max-w-md pt-4">
      <Link href="/home" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
        Back
      </Link>
      <form onSubmit={review} className="mt-2 space-y-5 rounded-2xl bg-card p-6 shadow-lg">
        <h1 className="text-lg font-medium text-muted-foreground">Split money you receive</h1>
        <p className="text-4xl font-bold tracking-tight tabular-nums">{percent}%</p>
        <p className="text-sm text-muted-foreground">
          of every payment that reaches your wallet goes straight to your {pocketName.trim() || "pocket"}. The rest stays
          for spending.
        </p>
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
            className="w-full accent-primary"
          />
        </div>
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
