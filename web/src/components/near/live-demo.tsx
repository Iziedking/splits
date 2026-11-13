"use client";

/**
 * "Watch a payment divide" on the landing page. Nothing loads until the button is pressed; then one
 * real $1.00 of test USDC goes on NEAR testnet from a demo payer to a demo person with a saved split
 * (server/near/live-demo.ts), and the panel shows what the router actually paid, with proof.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PurposeDot } from "@/components/app/purpose-dot";
import { Button } from "@/components/ui/button";
import { txUrl } from "@/lib/near/config";
import { formatDollars } from "@/lib/near/payment";
import { cn } from "@/lib/utils";
import { SplitBar } from "./split-card";

type Leg = { purpose: string; amount: string; landed: boolean };
type State =
  | { kind: "idle" }
  | { kind: "sending"; since: number }
  | { kind: "done"; hash: string; total: string; legs: Leg[] }
  | { kind: "failed"; message: string };

const Ctx = createContext<{ state: State; start: () => void } | null>(null);

export function LiveDemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = useRef(false);
  async function start() {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: "sending", since: Date.now() });
    if (window.matchMedia("(max-width: 1023px)").matches) document.getElementById("live-demo")?.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      const res = await fetch("/api/near/live-demo", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.hash) throw new Error(body?.error?.message ?? "The payment did not go through.");
      setState({ kind: "done", hash: body.hash, total: body.total, legs: body.legs });
    } catch (e) {
      setState({ kind: "failed", message: e instanceof Error && e.message !== "Failed to fetch" ? e.message : "We could not reach the network." });
    } finally {
      busy.current = false;
    }
  }
  return <Ctx.Provider value={{ state, start }}>{children}</Ctx.Provider>;
}

const useLiveDemo = () => useContext(Ctx)!;

/** The payment the demo just made, for the "Divided just now" strip; null until one lands. */
export function useLiveDemoResult() {
  const s = useContext(Ctx)?.state;
  return s?.kind === "done" ? s : null;
}

export function LiveDemoButton() {
  const { state, start } = useLiveDemo();
  return (
    <Button busy={state.kind === "sending"} onClick={() => void start()}>
      Watch a payment divide
    </Button>
  );
}

/** Before the first press it shows `fallback` (the illustration). */
export function LiveDemoPanel({ fallback }: { fallback: ReactNode }) {
  const { state, start } = useLiveDemo();
  if (state.kind === "idle") return <>{fallback}</>;
  return (
    <div id="live-demo" className="relative overflow-hidden rounded-[1.75rem] bg-primary-fill px-6 py-10 sm:px-10 sm:py-14" aria-live="polite">
      <div className="absolute -top-28 -left-20 h-80 w-80 rounded-full bg-purpose-1/55 blur-[90px]" />
      <div className="absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-purpose-2/45 blur-[100px]" />
      <div className="relative mx-auto w-full max-w-sm">
        <p className="text-sm text-white/85">A demo payer pays a demo person $1.00. Their saved rule: 30% tax, 20% savings, the rest to spend.</p>
        <div className="mt-3 rounded-2xl bg-white/95 p-6 text-foreground shadow-panel">
          {state.kind === "sending" && <Sending since={state.since} />}
          {state.kind === "done" && <Divided total={state.total} legs={state.legs} hash={state.hash} />}
          {state.kind === "failed" && (
            <div>
              <p className="font-semibold">That payment did not go through.</p>
              <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
              <Button className="mt-4" size="sm" onClick={() => void start()}>
                Try again
              </Button>
            </div>
          )}
          <p className="mt-5 border-t border-foreground/8 pt-4 text-xs text-muted-foreground">Real payment on NEAR testnet. Test money with no value.</p>
        </div>
        {state.kind === "done" && (
          <button type="button" className="mt-4 text-sm font-medium text-white underline underline-offset-4" onClick={() => void start()}>
            Send another
          </button>
        )}
      </div>
    </div>
  );
}

function Sending({ since }: { since: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), Math.max(0, 6000 - (Date.now() - since)));
    return () => clearTimeout(t);
  }, [since]);
  return (
    <div>
      <p className="text-sm text-muted-foreground">Payment on its way</p>
      <p className="figure mt-1 text-figure-lg leading-none tabular-nums">$1.00</p>
      <div className="mt-5 h-3 overflow-hidden rounded-full bg-foreground/8">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{slow ? "The network is slow right now. Still going; this can take up to 30 seconds." : "Sending on NEAR testnet…"}</p>
    </div>
  );
}

function useCount(target: number, ms = 1100) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Divided({ total, legs, hash }: { total: string; legs: Leg[]; hash: string }) {
  const [split, setSplit] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSplit(true), 350);
    return () => clearTimeout(t);
  }, []);
  const weights = legs.map((l) => Number(l.amount));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm text-muted-foreground">Payment arrived</p>
        <a className="text-xs font-medium text-primary-text underline underline-offset-4" href={txUrl(hash)} target="_blank" rel="noreferrer">
          View proof
        </a>
      </div>
      <p className="figure mt-1 text-figure-lg leading-none tabular-nums">{formatDollars(BigInt(total))}</p>
      <div className={cn("mt-5 transition-opacity duration-500", split ? "opacity-100" : "opacity-40")}>
        <SplitBar weights={split ? weights : [1]} />
      </div>
      <ul className="mt-5 space-y-3">
        {legs.map((l, i) => (
          <Row key={l.purpose} index={i} leg={l} hash={hash} show={split} />
        ))}
      </ul>
    </div>
  );
}

function Row({ index, leg, hash, show }: { index: number; leg: Leg; hash: string; show: boolean }) {
  const cents = useCount(show ? Number(leg.amount) / 10_000 : 0, 1100 + index * 150);
  return (
    <li className={cn("flex items-center gap-3 transition-all duration-500", show ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0")} style={{ transitionDelay: `${index * 120}ms` }}>
      <PurposeDot index={index} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{leg.purpose}</span>
        <a className="text-sm text-primary-text underline underline-offset-4" href={txUrl(hash)} target="_blank" rel="noreferrer">
          View proof
        </a>
      </span>
      <span className="font-semibold tabular-nums">{leg.landed ? `$${(cents / 100).toFixed(2)}` : "Returned"}</span>
    </li>
  );
}
