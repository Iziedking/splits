"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { CountUp } from "@/components/app/count-up";
import { Ribbon } from "@/components/app/ribbon";
import { SplitCard } from "@/components/app/split-card";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, errorMessage, type SplitView, type TransferView } from "@/lib/api";
import { isFinal, sentThisMonth, STATUS_LABEL } from "@/lib/format";
import { PURPOSE_FILLS, purposeFill } from "@/lib/palette";
import { cn } from "@/lib/utils";

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
  const [transfers, setTransfers] = React.useState<TransferView[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        api<{ splits: SplitView[] }>("/api/splits"),
        api<{ transfers: TransferView[] }>("/api/transfers"),
      ]);
      setSplits(s.splits);
      setTransfers(t.transfers);
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
  const recent = transfers.filter((t) => t.status !== "awaiting_confirmation").slice(0, 8);

  return (
    <div className="space-y-8 pt-2">
      <section className="relative overflow-hidden rounded-[28px] bg-primary px-6 pt-6 pb-9 text-primary-foreground sm:px-8 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
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
          </div>
          <Button variant="light" onClick={() => router.push("/splits/new")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New split
          </Button>
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

      <section aria-labelledby="splits-heading">
        <h2 id="splits-heading" className="mb-4 text-2xl font-bold">
          Your splits
        </h2>
        {splits === null && !error ? (
          <div aria-busy="true" aria-label="Loading splits" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="h-72 rounded-[20px] bg-muted motion-safe:animate-pulse" />
          </div>
        ) : sendSplits.length === 0 ? (
          <div className="surface max-w-md p-6">
            <Ribbon parts={[{ label: "Rent", weight: 40 }, { label: "School fees", weight: 35 }, { label: "Upkeep", weight: 25 }]} />
            <p className="display-face mt-5 text-2xl font-bold">
              Tell your money where to go.
            </p>
            <p className="mt-2 text-muted-foreground">
              Name who gets paid and what each part is for. Set it up once and use it every month.
            </p>
            <Button className="mt-6 w-full" onClick={() => router.push("/splits/new")}>
              Create your first split
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
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
            {rule && (
              <Ribbon className="mt-4 max-w-md" parts={rule.legs.map((l) => ({ label: l.name, weight: l.percent ?? 0 }))} />
            )}
          </div>
          {!rule && (
            <Button variant="secondary" onClick={() => router.push("/rules/new")}>
              Set it up
            </Button>
          )}
        </div>
      </section>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-4 text-2xl font-bold">
          Recent payments
        </h2>
        {recent.length === 0 ? (
          <p className="text-muted-foreground">Payments you send will show here, each with its receipt.</p>
        ) : (
          <ul className="surface divide-y divide-border overflow-hidden">
            {recent.map((t) => {
              const split = splits?.find((s) => s.id === t.splitId);
              return (
                <li key={t.id}>
                  <Link
                    href={`/payments/${t.id}`}
                    className="flex min-h-16 items-center gap-4 px-5 py-3 transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:outline-none"
                  >
                    <span aria-hidden="true" className="flex shrink-0 -space-x-1.5">
                      {t.legs.slice(0, 3).map((_, i) => (
                        <span key={i} className="h-4 w-4 rounded-full border-2 border-card" style={{ backgroundColor: purposeFill(i) }} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {t.kind === "auto" ? "Automatic split" : (split?.name ?? "Payment")}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {new Date(t.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })},{" "}
                        <span className={cn(t.status === "failed" && "text-destructive", t.status === "settled" && "text-success")}>
                          {STATUS_LABEL[t.status]?.toLowerCase()}
                        </span>
                      </span>
                    </span>
                    <span className="figure text-lg">${t.amount}</span>
                    {!isFinal(t.status) && (
                      <span className="h-2.5 w-2.5 rounded-full bg-purpose-1 motion-safe:animate-pulse" aria-label="In progress" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
