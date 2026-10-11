"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { Backdrop } from "@/components/app/backdrop";
import { Landed } from "@/components/app/landed";
import { VisitorHeader } from "@/components/app/visitor-header";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { api, errorMessage, type VisitorPaymentView } from "@/lib/api";
import { isFinal } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS = [
  { label: "Sent from your wallet", done: (s: string) => s === "verifying" || s === "settled" },
  { label: "Settled on Arc", done: (s: string) => s === "settled" },
  { label: "Receipt checked", done: (s: string) => s === "settled" },
];

/** A visitor's payment, by its private link. Polling also moves it forward on the server. */
export default function VisitorPayment() {
  const { token } = useParams<{ token: string }>();
  const [p, setP] = React.useState<VisitorPaymentView | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await api<{ payment: VisitorPaymentView }>(`/api/visitor/payments/${token}`);
        if (stopped) return;
        setP(res.payment);
        setError(null);
        if (isFinal(res.payment.status)) return;
      } catch (err) {
        if (!stopped) setError(errorMessage(err));
      }
      timer = setTimeout(poll, 1200);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [token]);

  const night = p?.status === "verifying";
  return (
    <div className={cn("min-h-screen", night && "text-white")}>
      <Backdrop tone={night ? "night" : "day"} />
      <VisitorHeader />
      <main className="mx-auto max-w-md px-5 pt-4 pb-16" aria-live="polite">
        {!p ? (
          error ? (
            <div className="enter space-y-3 pt-6">
              <h1 className="text-[2rem] leading-tight font-extrabold">This payment link doesn&apos;t open.</h1>
              <p className="text-muted-foreground">
                {error === "Payment not found"
                  ? "It may have been cut short when it was copied. Check the link, or start a new payment."
                  : error}
              </p>
              <Link href="/send" className="font-semibold text-primary underline underline-offset-4">
                Pay from your wallet
              </Link>
            </div>
          ) : (
            <div aria-busy="true" aria-label="Loading payment" className="surface h-96 motion-safe:animate-pulse" />
          )
        ) : p.status === "settled" ? (
          <>
            <Landed
              t={p}
              preview={false}
              returnTo={`/p/${token}`}
              actions={
                <Link
                  href="/send"
                  className="inline-flex min-h-[52px] w-full items-center justify-center rounded-full bg-white/70 px-6 text-[15px] font-semibold text-primary ring-1 ring-primary/70 hover:bg-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  Pay someone else
                </Link>
              }
            />
            <EmailReceipt token={token} />
          </>
        ) : p.status === "verifying" ? (
          <div className="enter pt-6">
            <h1 className="text-[2rem] leading-tight font-extrabold">Sending…</h1>
            <p className="mt-1 text-white/70">${p.amount}, settling on Arc.</p>
            <ol aria-label="Progress" className="surface-night mt-6 space-y-4 p-5">
              {STEPS.map((step) => (
                <li key={step.label} className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={cn("h-4 w-4 rounded-full", step.done(p.status) ? "bg-primary" : "border-2 border-white motion-safe:animate-pulse")}
                  />
                  <span className="font-medium">{step.label}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : p.status === "awaiting_wallet" ? (
          p.expiresAt && new Date(p.expiresAt) < new Date() ? (
            <Expired />
          ) : (
            <div className="enter space-y-3 pt-6">
              <h1 className="text-[2rem] leading-tight font-extrabold">Waiting for your wallet</h1>
              <p className="text-muted-foreground">
                Approve and send in your wallet. This page updates by itself, and this link keeps working if you close it.
              </p>
            </div>
          )
        ) : p.status === "cancelled" && !p.txHash ? (
          <Expired />
        ) : (
          <div className="enter space-y-4 pt-6">
            <h1 className="text-[2rem] leading-tight font-extrabold">Not sent</h1>
            {p.error && (
              <Notice tone="error" className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {p.error}
              </Notice>
            )}
            <Link href="/send" className="font-semibold text-primary underline underline-offset-4">
              Back to Pay
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

function Expired() {
  return (
    <div className="enter space-y-3 pt-6">
      <h1 className="text-[2rem] leading-tight font-extrabold">This took longer than 30 minutes</h1>
      <p className="text-muted-foreground">Nothing moved from your wallet. Check the list again to pay.</p>
      <Link href="/send" className="font-semibold text-primary underline underline-offset-4">
        Check the list again
      </Link>
    </div>
  );
}

function EmailReceipt({ token }: { token: string }) {
  const [email, setEmail] = React.useState("");
  const [state, setState] = React.useState<{ busy: boolean; done: string | null; error: string | null }>({
    busy: false,
    done: null,
    error: null,
  });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true, done: null, error: null });
    try {
      await api(`/api/visitor/payments/${token}/email`, { body: { email } });
      setState({ busy: false, done: email, error: null });
    } catch (err) {
      setState({ busy: false, done: null, error: errorMessage(err) });
    }
  }

  return (
    <form onSubmit={send} className="surface mt-6 space-y-3 p-5">
      <Field label="Email me my receipt" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button type="submit" variant="secondary" className="w-full" busy={state.busy}>
        Send receipt
      </Button>
      {state.done && <Notice tone="success">Sent to {state.done}</Notice>}
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </form>
  );
}
