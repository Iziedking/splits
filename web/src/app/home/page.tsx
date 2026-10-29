"use client";

import { ArrowDownLeft, ChevronRight, Plus, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ActivityList } from "@/components/app/activity-list";
import { AddMoney } from "@/components/app/add-money";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { CopyAddress } from "@/components/app/copy-address";
import { CountUp } from "@/components/app/count-up";
import { Ribbon } from "@/components/app/ribbon";
import { StartSomething } from "@/components/app/start-something";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, errorMessage, type ActivityView, type EarnStatus, type SplitView } from "@/lib/api";
import { cents, greetingName, isFinal } from "@/lib/format";

export default function HomePage() {
  return (
    <AppFrame wide>
      <Home />
    </AppFrame>
  );
}

/** Home (UI_BRIEF.md v4, frames S2 Home and Dashboard). */
function Home() {
  const router = useRouter();
  const { me, refresh } = useMe();
  const [splits, setSplits] = React.useState<SplitView[] | null>(null);
  const [activity, setActivity] = React.useState<ActivityView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [receiving, setReceiving] = React.useState(false);
  // The Earning pocket's chain balance leaves out what is in the vault; its total comes from /api/earn.
  const [earning, setEarning] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!me.earn) return;
    api<{ status: EarnStatus }>("/api/earn")
      .then((r) => setEarning(r.status.available && r.status.pocket ? r.status.pocket.total : null))
      .catch(() => undefined);
  }, [me.earn, me.wallets]);
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

  // One list on a phone (the `order-*` classes keep the v4 order). From `lg` (v5, frame "MacBook
  // Air - 3") the greeting has its own row and two columns follow, their tops aligned: balance,
  // automatic split and splits on the left; Send, Receive and recent transfers on the right. The
  // column wrappers are `contents` on a phone, so their children join the single flex list.
  return (
    <div className="enter pt-4">
      <h1 className="text-title leading-tight font-extrabold">Hi, {greetingName(me.user.email)}</h1>
      <div className="mt-7 flex flex-col gap-7 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(22rem,1fr)] lg:items-start lg:gap-12">
        <div className="contents lg:flex lg:flex-col lg:gap-7">
          <section aria-label="Your balance" className="surface order-1 p-5 lg:order-none">
            <p className="text-sm text-muted-foreground">Balance</p>
            <p className="figure mt-1 text-display leading-none">
              <CountUp value={main?.balance ?? "0.00"} />
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {pockets.map((p) =>
                p.earn ? (
                  <Link
                    key={p.id}
                    href="/earn"
                    className="rounded-full bg-white/80 px-3 py-1 text-sm ring-1 ring-border hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Earning <span className="font-semibold tabular-nums">≈ ${cents(earning ?? p.balance ?? "0.00")}</span>
                  </Link>
                ) : (
                  <span key={p.id} className="rounded-full bg-white/80 px-3 py-1 text-sm ring-1 ring-border">
                    {p.label} <span className="font-semibold tabular-nums">${p.balance}</span>
                  </span>
                ),
              )}
              {main && <CopyAddress address={main.address} tone="dark" className="ml-auto" />}
            </div>
          </section>
          {error && (
            <div className="order-3 space-y-3 lg:order-none">
              <Notice tone="error">{error}</Notice>
              <Button variant="secondary" className="w-full" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          )}
          <section aria-labelledby="auto-heading" className="order-6 space-y-4 lg:order-none">
            <div className="surface p-5">
              <h2 id="auto-heading" className="font-bold">
                {rule ? rule.name : "Divide incoming money automatically"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {rule
                  ? rule.status === "pending"
                    ? "Setting up on Arc."
                    : "Runs by itself on every payment that reaches your wallet."
                  : "Put part of every payment you receive into savings, by itself."}
              </p>
              {rule && <Ribbon className="mt-4" height={8} parts={rule.legs.map((l) => ({ label: l.name, weight: l.percent ?? 0 }))} />}
            </div>
            {!rule && (
              <Button className="w-full" onClick={() => router.push("/rules/new")}>
                Create a rule
              </Button>
            )}
          </section>
          <section aria-labelledby="splits-heading" className="order-4 lg:order-none">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="splits-heading" className="text-xl font-extrabold">
                Saved splits
              </h2>
              {sendSplits.length > 0 && (
                <Link
                  href="/splits/new"
                  className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-primary-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New split
                </Link>
              )}
            </div>
            {splits === null && !error ? (
              <div aria-busy="true" aria-label="Loading splits" className="surface h-24 motion-safe:animate-pulse" />
            ) : sendSplits.length === 0 ? (
              <div className="surface p-5">
                <Ribbon height={8} parts={[{ label: "Rent", weight: 40 }, { label: "School fees", weight: 35 }, { label: "Upkeep", weight: 25 }]} />
                <p className="mt-4 text-lg font-bold">Tell your money where to go.</p>
                <p className="mt-1 text-muted-foreground">Name who gets paid and what each part is for. Set it up once and use it every month.</p>
                <Button className="mt-5 w-full" onClick={() => router.push("/splits/new")}>
                  Create your first split
                </Button>
              </div>
            ) : (
              <ul className="space-y-3">
                {sendSplits.map((split) => (
                  <li key={split.id}>
                    <Link
                      href={`/send/${split.id}`}
                      className="surface flex items-center gap-3 p-4 transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:hover:translate-y-0"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{split.name}</span>
                        <Ribbon
                          className="mt-3"
                          height={8}
                          parts={split.legs.map((l) => ({ label: l.name, weight: l.percent ?? Number(l.fixed ?? 0) }))}
                        />
                        <span className="mt-2 block truncate text-sm text-muted-foreground">
                          {split.status === "pending" ? "Setting up on Arc" : split.legs.map((l) => l.name).join(" · ")}
                        </span>
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="order-7 lg:order-none">
            <StartSomething />
          </div>
        </div>
        <div className="contents lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-7">
          {/* The frame makes Receive the filled button on desktop; the phone keeps v4's Send. */}
          <div className="order-2 grid grid-cols-2 gap-3 lg:order-none">
            <Button className="lg:hidden" onClick={() => router.push("/pay")}>
              <Send className="h-4 w-4" aria-hidden="true" />
              Send money
            </Button>
            <Button variant="secondary" className="hidden lg:inline-flex" onClick={() => router.push("/pay")}>
              <Send className="h-4 w-4" aria-hidden="true" />
              Send money
            </Button>
            <Button variant="secondary" className="lg:hidden" onClick={() => setReceiving(true)}>
              <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
              Receive
            </Button>
            <Button className="hidden lg:inline-flex" onClick={() => setReceiving(true)}>
              <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
              Receive
            </Button>
          </div>
          <section aria-labelledby="activity-heading" className="order-5 lg:order-none">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="activity-heading" className="text-xl font-extrabold">
                Recent transfers
              </h2>
              <Link
                href="/history"
                className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-primary-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                See all
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <ActivityList activity={activity} splitNames={splitNames} onRetry={() => void load()} recent={4} />
          </section>
        </div>
      </div>

      {main && (
        <AddMoney
          title="Receive money"
          address={main.address}
          network={me.network}
          open={receiving}
          onClose={() => setReceiving(false)}
        />
      )}
    </div>
  );
}
