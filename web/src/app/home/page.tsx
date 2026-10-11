"use client";

import { ArrowRight, Plus, Repeat } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { PaymentSummaryCard } from "@/components/ui/card-3";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, errorMessage, type SplitView, type TransferView } from "@/lib/api";
import { initials, isFinal, sentThisMonth, STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <AppFrame>
      <Home />
    </AppFrame>
  );
}

function purposes(split: SplitView): string {
  const list = [...new Set(split.legs.map((l) => l.purpose))].join(", ");
  return list.charAt(0).toUpperCase() + list.slice(1);
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

  return (
    <div className="space-y-10">
      <section className="enter flex flex-wrap items-end justify-between gap-4 pt-4">
        <div>
          <p className="text-sm text-muted-foreground">In your wallet</p>
          <p className="text-3xl font-bold tracking-tight tabular-nums">${main?.balance ?? "0.00"}</p>
          {pockets.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {pockets.map((p) => `${p.label} $${p.balance}`).join(" · ")}
            </p>
          )}
        </div>
        <Button onClick={() => router.push("/splits/new")}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New split
        </Button>
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
        <h2 id="splits-heading" className="sr-only">
          Your splits
        </h2>
        {splits === null && !error ? (
          <div aria-busy="true" aria-label="Loading splits" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="h-64 rounded-2xl bg-muted/60 motion-safe:animate-pulse" />
          </div>
        ) : sendSplits.length === 0 ? (
          <div className="enter max-w-sm rounded-2xl bg-card p-6 shadow-lg">
            <h3 className="text-lg font-medium text-muted-foreground">No splits yet</h3>
            <p className="mt-2 text-2xl font-bold tracking-tight">Tell your money where to go.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Name who gets paid and what each part is for. You set it up once and use it every month.
            </p>
            <Button className="mt-6 w-full" onClick={() => router.push("/splits/new")}>
              Create your first split
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {sendSplits.map((split, i) => (
              <div key={split.id} className="enter" style={{ animationDelay: `${i * 50}ms` }}>
                <PaymentSummaryCard
                  className="max-w-none"
                  title="Sent this month"
                  amount={sentThisMonth(transfers, split.id)}
                  subCardTitle={split.name}
                  subCardSubtitle={
                    split.status === "pending"
                      ? "Setting up on Arc..."
                      : split.status === "failed"
                        ? "Couldn't be set up"
                        : purposes(split)
                  }
                  avatars={split.legs.slice(0, 3).map((l) => ({ initials: initials(l.name), alt: l.name }))}
                  moreCount={Math.max(0, split.legs.length - 3)}
                  onSubCardClick={split.status === "active" ? () => router.push(`/send/${split.id}`) : undefined}
                />
                {split.status === "failed" && split.error && (
                  <p className="mt-2 text-sm text-destructive">{split.error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="auto-heading" className="enter rounded-2xl bg-muted/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Repeat className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <div>
              <h2 id="auto-heading" className="font-semibold">
                {rule ? rule.name : "Split money you receive"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {rule
                  ? rule.status === "pending"
                    ? "Setting up on Arc..."
                    : `Runs on every payment that reaches your wallet: ${rule.legs
                        .map((l) => `${l.percent ?? l.fixed}${l.percent ? "%" : " USDC"} ${l.name.toLowerCase()}`)
                        .join(", ")}`
                  : "Put part of every payment you receive into savings, automatically."}
              </p>
            </div>
          </div>
          {!rule && (
            <Button variant="secondary" onClick={() => router.push("/rules/new")}>
              Set it up
            </Button>
          )}
        </div>
      </section>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-3 text-lg font-medium text-muted-foreground">
          Recent payments
        </h2>
        {transfers.filter((t) => t.status !== "awaiting_confirmation").length === 0 ? (
          <p className="text-sm text-muted-foreground">Payments you send will show here, each with its receipt.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl bg-card shadow-sm ring-1 ring-border">
            {transfers
              .filter((t) => t.status !== "awaiting_confirmation")
              .slice(0, 8)
              .map((t) => {
                const split = splits?.find((s) => s.id === t.splitId);
                return (
                  <li key={t.id}>
                    <Link
                      href={`/payments/${t.id}`}
                      className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                    >
                      <span>
                        <span className="block font-medium">
                          {t.kind === "auto" ? "Automatic split" : (split?.name ?? "Payment")}
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {new Date(t.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} ·{" "}
                          <span className={cn(t.status === "failed" && "text-destructive")}>{STATUS_LABEL[t.status]}</span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2 font-semibold tabular-nums">
                        ${t.amount}
                        {!isFinal(t.status) && (
                          <span className="h-2 w-2 rounded-full bg-amber-500 motion-safe:animate-pulse" aria-label="In progress" />
                        )}
                        <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </span>
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
