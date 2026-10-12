"use client";

import { ChevronRight, Landmark } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { AgentComposer } from "@/components/app/agent-composer";
import { ConfirmDialog, type Proof } from "@/components/app/confirm-dialog";
import { FeeLines } from "@/components/app/fee-lines";
import { PayoutComposer } from "@/components/app/payout-composer";
import { ReviewTable } from "@/components/app/review-table";
import { Ribbon } from "@/components/app/ribbon";
import { VisitorLimit } from "@/components/app/visitor-limit";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, ApiError, errorMessage, type ActionView, type ComposerFill, type PayoutCheck, type SplitView, type TransferView } from "@/lib/api";
import { purposeFill } from "@/lib/palette";
import { cn } from "@/lib/utils";

export default function PayPage() {
  return (
    <AppFrame>
      <Pay />
    </AppFrame>
  );
}

type Mode = "one" | "many" | "saved";

const TABS: { mode: Mode; label: string }[] = [
  { mode: "one", label: "One person" },
  { mode: "many", label: "Many people" },
  { mode: "saved", label: "Saved split" },
];

/** Cents of a USDC decimal string, for comparing a balance with a total without float error. */
function cents(value: string): number {
  const [whole = "0", fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

function Pay() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { me } = useMe();
  const [mode, setMode] = React.useState<Mode>("one");
  const [label, setLabel] = React.useState("payment");
  const [check, setCheck] = React.useState<PayoutCheck | null>(null);
  const [fundWith, setFundWith] = React.useState<"card" | "balance">("card");
  const [cardChosen, setCardChosen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** The error is the send limit, shown with what to do next. */
  const [limited, setLimited] = React.useState(false);
  const [pending, setPending] = React.useState<{ action: ActionView; transfer: TransferView } | null>(null);
  const [splits, setSplits] = React.useState<SplitView[] | null>(null);
  /** Agentic mode: the switch, and the list it drafted (applied once per id). */
  const [agentOn, setAgentOn] = React.useState(false);
  /** A draft is being read; the switch waits so the result can't land on a composer in use. */
  const [drafting, setDrafting] = React.useState(false);
  const [fill, setFill] = React.useState<(ComposerFill & { id: number }) | null>(null);

  // Starting points arrive as ?mode=many&template=giveaway or ?fund=card. Read after mount so the
  // page needs no suspense boundary.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get("mode");
    if (m === "one" || m === "many" || m === "saved") setMode(m);
    if (params.get("template") === "giveaway") setLabel("giveaway prize");
    if (params.get("fund") === "card") setCardChosen(true);
  }, []);

  React.useEffect(() => {
    if (mode !== "saved" || splits) return;
    api<{ splits: SplitView[] }>("/api/splits")
      .then((r) => setSplits(r.splits))
      .catch((err) => setError(errorMessage(err)));
  }, [mode, splits]);

  const balance = me.wallets.find((w) => w.kind === "main")?.balance ?? "0.00";
  const charge = check?.charge ?? check?.total ?? null;
  const canUseBalance = charge ? cents(balance) >= cents(charge) : false;

  // Default to the balance when it covers the total, unless the person came here for the card.
  React.useEffect(() => {
    if (!check?.ready) return;
    setFundWith(canUseBalance && !cardChosen ? "balance" : "card");
  }, [check, canUseBalance, cardChosen]);

  function onChecked(next: PayoutCheck | null) {
    setCheck(next);
    setError(null);
  }

  async function pay() {
    if (!check?.draft) return;
    setBusy(true);
    setError(null);
    try {
      setPending(
        await api<{ action: ActionView; transfer: TransferView }>("/api/transfers", {
          body: { draftId: check.draft.id, draftHash: check.draft.hash, fundWith },
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
      setLimited(err instanceof ApiError && err.code === "SEND_LIMIT");
      if (err instanceof ApiError && (err.code === "LIST_CHANGED" || err.code === "LIST_ALREADY_PAID")) setCheck(null);
      if (err instanceof ApiError && (err.code === "FUNDING_LIMIT" || err.code === "FUNDING_OFF") && canUseBalance) {
        setFundWith("balance");
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirm(proof: Proof) {
    if (!pending) return;
    try {
      const res = await api<{ transfer: TransferView }>("/api/transfers/confirm", {
        body: { actionId: pending.action.id, ...proof },
      });
      router.replace(`/payments/${res.transfer.id}`);
    } catch (err) {
      // An earlier attempt went through even though its answer never arrived: show that payment.
      if (err instanceof ApiError && err.code === "ALREADY_CONFIRMED") {
        router.replace(`/payments/${pending.transfer.id}`);
        return;
      }
      throw err;
    }
  }

  /**
   * Closing the approval never assumes nothing happened: if the PIN reached the server but the reply
   * was lost, the payment is under way, and paying the list again would pay everyone twice.
   */
  async function closeApproval() {
    const id = pending?.transfer.id;
    setPending(null);
    setCheck(null);
    if (!id) return;
    try {
      const { transfer } = await api<{ transfer: TransferView }>(`/api/transfers/${id}`);
      if (transfer.status === "awaiting_confirmation") setError("Payment not sent. Check again to pay.");
      else router.replace(`/payments/${id}`);
    } catch {
      setError("We couldn't tell whether this payment went through. Check Activity on Home before paying again.");
    }
  }

  const count = check?.lines.length ?? 0;
  const payLabel = charge ? (count === 1 ? `Pay $${charge}` : `Pay ${count} people $${charge}`) : "Pay";

  return (
    <div className="enter space-y-6 pt-4">
      <div>
        <h1 className="text-[2rem] leading-tight font-extrabold">Send money</h1>
        <p className="mt-2 text-muted-foreground">
          Anyone, by email or Arc address. Everyone is paid in one transaction, or nobody is.
        </p>

        {me.agent && (
          <button
            type="button"
            role="switch"
            aria-checked={agentOn}
            disabled={drafting}
            onClick={() => setAgentOn((on) => !on)}
            className="mt-6 flex min-h-11 w-full items-center justify-between gap-3 rounded-full bg-white/60 px-4 text-sm font-semibold ring-1 ring-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
          >
            Try agentic mode
            <span className={cn("relative h-6 w-10 rounded-full transition-colors motion-reduce:transition-none", agentOn ? "bg-primary" : "bg-muted")} aria-hidden="true">
              <span
                className={cn(
                  "absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
                  agentOn ? "translate-x-[18px]" : "translate-x-0.5",
                )}
              />
            </span>
          </button>
        )}

        {!agentOn && (
          <>
            <div role="tablist" aria-label="Who gets paid" className="mt-6 grid grid-cols-3 rounded-full bg-white/60 p-1 ring-1 ring-white">
              {TABS.map((tab) => (
                <button
                  key={tab.mode}
                  type="button"
                  role="tab"
                  aria-selected={mode === tab.mode}
                  onClick={() => {
                    setMode(tab.mode);
                    setFill(null);
                    setCheck(null);
                    setError(null);
                  }}
                  className={cn(
                    "relative z-10 min-h-11 rounded-full px-1 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    mode === tab.mode ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode === tab.mode && (
                    <motion.span
                      layoutId="pay-mode"
                      className="absolute inset-0 -z-10 rounded-full bg-primary"
                      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  {tab.label}
                </button>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" aria-disabled="true">
              <Landmark className="h-4 w-4" aria-hidden="true" />
              Bank or mobile money
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">Coming soon</span>
            </p>
          </>
        )}

        <div className="surface mt-6 p-5">
          {agentOn && (
            <AgentComposer
              onBusy={setDrafting}
              onFilled={(f) => {
                setFill({ ...f, id: Date.now() });
                setMode("many");
                setCheck(null);
                setError(null);
                setAgentOn(false);
              }}
            />
          )}
          {/* Stays mounted while agentic mode is on, so what was typed (and Undo's snapshot) survives. */}
          <div hidden={agentOn}>
            {mode === "saved" ? (
              <SavedSplits splits={splits} />
            ) : (
              <PayoutComposer key={mode} mode={mode} initialLabel={label} onChecked={onChecked} fill={mode === "many" ? fill : null} />
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4" aria-live="polite">
        {!agentOn && mode !== "saved" && !check && (
          <div className="rounded-[20px] border border-dashed border-border p-6 text-muted-foreground">
            <Ribbon height={10} parts={[1, 1, 1, 1, 1].map((w, i) => ({ label: `Person ${i + 1}`, weight: w }))} />
            <p className="mt-4">Check {mode === "one" ? "the payment" : "your list"} to see exactly what each person gets before anything moves.</p>
          </div>
        )}
        {!agentOn && check && (
          <>
            <ReviewTable check={check} />
            {check.ready ? (
              <div className="surface space-y-4 p-5">
                {check.fee && check.charge && <FeeLines fee={check.fee} percent={check.feePercent} total={check.charge} />}
                <div role="radiogroup" aria-label="Pay from" className="grid grid-cols-2 gap-2">
                  {(["balance", "card"] as const).map((option) => {
                    const disabled = option === "balance" && !canUseBalance;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={fundWith === option}
                        disabled={disabled}
                        onClick={() => setFundWith(option)}
                        className={cn(
                          "min-h-16 rounded-2xl px-4 py-3 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                          fundWith === option ? "bg-white ring-2 ring-primary" : "bg-white/60 ring-1 ring-white hover:bg-white",
                        )}
                      >
                        <span className="block font-semibold">{option === "balance" ? "Balance" : "Demo card"}</span>
                        <span className={cn("block", "text-muted-foreground")}>
                          {option === "balance" ? (disabled ? `$${balance}, add money first` : `$${balance}`) : "Simulated card, small daily limit"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {error && (limited ? <VisitorLimit message={error} signedIn /> : <Notice tone="error">{error}</Notice>)}
                <Button className="w-full" busy={busy} onClick={() => void pay()}>
                  {payLabel}
                </Button>
              </div>
            ) : (
              <Notice tone="error">Fix or remove the marked lines, then check again.</Notice>
            )}
          </>
        )}
        {!check && error && <Notice tone="error">{error}</Notice>}
      </div>

      <ConfirmDialog
        actionId={pending?.action.id ?? null}
        title="Approve this payment"
        hasPasskey={me.user.hasPasskey}
        onConfirm={confirm}
        onClose={() => void closeApproval()}
      >
        {pending && (
          <div className="space-y-3 text-sm">
            <p className="figure text-4xl">${pending.transfer.amount}</p>
            <FeeLines fee={pending.transfer.fee} percent={pending.transfer.feePercent} total={pending.transfer.total} />
            <p className="text-muted-foreground">
              {pending.transfer.recipients === 1 ? "To 1 person" : `To ${pending.transfer.recipients} people`}, for{" "}
              {pending.transfer.legs[0]?.purpose}
            </p>
            <Ribbon parts={pending.transfer.legs.slice(0, 12).map((l) => ({ label: l.name, weight: Number(l.amount) }))} />
            <ul className="max-h-48 space-y-1.5 overflow-y-auto">
              {pending.transfer.legs.map((leg, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: purposeFill(i) }} />
                    <span className="truncate">{leg.name}</span>
                  </span>
                  <span className="font-semibold tabular-nums">${leg.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

function SavedSplits({ splits }: { splits: SplitView[] | null }) {
  if (!splits) return <div aria-busy="true" aria-label="Loading splits" className="h-32 rounded-2xl bg-white/60 motion-safe:animate-pulse" />;
  const ready = splits.filter((s) => !s.automatic && s.status === "active");
  if (ready.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">A saved split pays the same people the same way every time, like rent, school fees and upkeep.</p>
        <Link
          href="/splits/new"
          className="inline-flex min-h-[52px] w-full items-center justify-center rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground hover:bg-primary-deep focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Create a split
        </Link>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {ready.map((s) => (
        <li key={s.id}>
          <Link
            href={`/send/${s.id}`}
            className="flex min-h-16 items-center gap-4 rounded-2xl bg-white/70 p-4 ring-1 ring-white transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{s.name}</span>
              <Ribbon className="mt-2" height={8} parts={s.legs.map((l) => ({ label: l.name, weight: l.percent ?? Number(l.fixed ?? 0) }))} />
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
