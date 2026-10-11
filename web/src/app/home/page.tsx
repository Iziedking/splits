"use client";

import { Plus, Send, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ActivityList } from "@/components/app/activity-list";
import { AddMoney } from "@/components/app/add-money";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { CopyAddress } from "@/components/app/copy-address";
import { CountUp } from "@/components/app/count-up";
import { Ribbon } from "@/components/app/ribbon";
import { SplitCard } from "@/components/app/split-card";
import { StartSomething } from "@/components/app/start-something";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, errorMessage, type ActivityView, type SplitView } from "@/lib/api";
import { isFinal, sentThisMonth } from "@/lib/format";
import { PURPOSE_FILLS } from "@/lib/palette";

export default function HomePage() {
  return (
    <AppFrame>
      <Home />
    </AppFrame>
  );
}

function Home() {
  const router = useRouter();
  const { me, refresh } = useMe();
  const [splits, setSplits] = React.useState<SplitView[] | null>(null);
  const [activity, setActivity] = React.useState<ActivityView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const transfers = activity?.sent ?? [];

  const load = React.useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api<{ splits: SplitView[] }>("/api/splits"), api<ActivityView>("/api/activity")]);
      setSplits(s.splits);
      setActivity(a);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Splits being registered onchain and payments in flight: poll until they finish.
  const pendingKey = [
    ...(splits ?? []).filter((s) => s.status === "pending").map((s) => s.id),
    ...transfers.filter((t) => !isFinal(t.status) && t.status !== "awaiting_confirmation").map((t) => t.id),
  ].join(",");
  React.useEffect(() => {
    if (!pendingKey) return;
    const timer = setInterval(async () => {
      const pendingSplits = (splits ?? []).filter((s) => s.status === "pending");
      await Promise.all(pendingSplits.map((s) => api(`/api/splits/${s.id}`).catch(() => undefined)));
      await Promise.all([load(), refresh()]);
    }, 1500);
    return () => clearInterval(timer);
    // pendingKey stands in for `splits`: it changes exactly when the set of moving items does.
  }, [pendingKey, load, refresh]);

  const main = me.wallets.find((w) => w.kind === "main");
  const pockets = me.wallets.filter((w) => w.kind === "pocket");
  const sendSplits = (splits ?? []).filter((s) => !s.automatic);
  const rule = (splits ?? []).find((s) => s.automatic && s.status !== "failed");
  const splitNames = Object.fromEntries((splits ?? []).map((sp) => [sp.id, sp.name]));

  return (
    <div className="grid gap-8 pt-2 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
      <div className="space-y-8">
        <section
          aria-label="Your wallet"
          className="relative overflow-hidden rounded-[28px] bg-primary px-6 pt-6 pb-9 text-primary-foreground sm:px-8 sm:pt-8"
        >
          <p className="text-[15px] text-white/70">In your wallet</p>
          <p className="figure mt-1 text-6xl sm:text-7xl">
            <CountUp value={main?.balance ?? "0.00"} />
          </p>
          {pockets.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {pockets.map((p) => (
                <li key={p.id} className="rounded-full bg-white/10 px-3 py-1 text-sm">
                  {p.label} <span className="font-semibold tabular-nums">${p.balance}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button variant="light" onClick={() => router.push("/pay")}>
              <Send className="h-4 w-4" aria-hidden="true" />
              Pay
            </Button>
            <Button variant="outlineLight" onClick={() => setAdding(true)}>
              <Wallet className="h-4 w-4" aria-hidden="true" />
              Add money
            </Button>
            {main && <CopyAddress address={main.address} className="sm:ml-auto" />}
          </div>
          {/* The brand's colour blocks, as a band along the bottom edge. */}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 flex h-2">
            {PURPOSE_FILLS.map((fill) => (
              <span key={fill} className="flex-1" style={{ backgroundColor: fill }} />
            ))}
          </div>
        </section>

        {error && (
          <div className="space-y-3">
            <Notice tone="error">{error}</Notice>
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        )}

        <section aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="mb-4 text-2xl font-bold">
            Activity
          </h2>
          <ActivityList activity={activity} splitNames={splitNames} onRetry={() => void load()} />
        </section>
      </div>

      <aside className="space-y-8" aria-label="Your splits and shortcuts">
        <section aria-labelledby="splits-heading">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="splits-heading" className="text-2xl font-bold">
              Your splits
            </h2>
            {sendSplits.length > 0 && (
              <Button variant="secondary" onClick={() => router.push("/splits/new")} className="min-h-11 px-4">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New split
              </Button>
            )}
          </div>
          {splits === null && !error ? (
            <div aria-busy="true" aria-label="Loading splits" className="h-60 rounded-[20px] bg-muted motion-safe:animate-pulse" />
          ) : sendSplits.length === 0 ? (
            <div className="surface p-6">
              <Ribbon parts={[{ label: "Rent", weight: 40 }, { label: "School fees", weight: 35 }, { label: "Upkeep", weight: 25 }]} />
              <p className="display-face mt-5 text-2xl font-bold">Tell your money where to go.</p>
              <p className="mt-2 text-muted-foreground">
                Name who gets paid and what each part is for. Set it up once and use it every month.
              </p>
              <Button className="mt-6 w-full" onClick={() => router.push("/splits/new")}>
                Create your first split
              </Button>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {sendSplits.map((split) => (
                <SplitCard
                  key={split.id}
                  split={split}
                  sentThisMonth={sentThisMonth(transfers, split.id)}
                  onOpen={() => router.push(`/send/${split.id}`)}
                />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="auto-heading" className="surface p-6">
          <h2 id="auto-heading" className="text-xl font-bold">
            {rule ? rule.name : "Split money you receive"}
          </h2>
          <p className="mt-1 text-muted-foreground">
            {rule
              ? rule.status === "pending"
                ? "Setting up on Arc."
                : "Runs by itself on every payment that reaches your wallet."
              : "Put part of every payment you receive into savings, automatically."}
          </p>
          {rule ? (
            <Ribbon className="mt-4" parts={rule.legs.map((l) => ({ label: l.name, weight: l.percent ?? 0 }))} />
          ) : (
            <Button variant="secondary" className="mt-4" onClick={() => router.push("/rules/new")}>
              Set it up
            </Button>
          )}
        </section>

        <StartSomething />
      </aside>

      {main && <AddMoney address={main.address} network={me.network} open={adding} onClose={() => setAdding(false)} />}
    </div>
  );
}
