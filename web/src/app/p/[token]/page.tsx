"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { Backdrop } from "@/components/app/backdrop";
import { CrossProgress } from "@/components/app/cross-progress";
import { CrossWalletSteps } from "@/components/app/cross-wallet-steps";
import { Landed } from "@/components/app/landed";
import { StepList } from "@/components/app/step-list";
import { VisitorHeader } from "@/components/app/visitor-header";
import { Loader } from "@/components/app/loader";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { api, errorMessage, type VisitorConfig, type VisitorPaymentView } from "@/lib/api";
import { burnSent, CROSS_WALLET_TEXT } from "@/lib/wallet/crossFlow";
import { nextPoll } from "@/lib/wallet/flow";
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
  const [config, setConfig] = React.useState<VisitorConfig | null>(null);

  React.useEffect(() => {
    api<VisitorConfig>("/api/visitor/config").then(setConfig).catch(() => undefined);
  }, []);

  React.useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await api<{ payment: VisitorPaymentView }>(`/api/visitor/payments/${token}`);
        if (stopped) return;
        setP(res.payment);
        setError(null);
        const wait = nextPoll(res.payment.status, res.payment.createdAt);
        if (wait === null) return;
        timer = setTimeout(poll, wait);
        return;
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

  const night = p?.status === "verifying" && !p.cross;
  return (
    <div className={cn("min-h-screen", night && "text-white")}>
      <Backdrop tone={night ? "night" : "day"} />
      <VisitorHeader wide />
      <main className="mx-auto max-w-md px-5 pt-4 pb-16 lg:max-w-5xl lg:px-10" aria-live="polite">
        {!p ? (
          error ? (
            <div className="enter space-y-3 pt-6">
              <h1 className="text-title leading-tight font-extrabold">This payment link doesn&apos;t open.</h1>
              <p className="text-muted-foreground">
                {error === "Payment not found"
                  ? "It may have been cut short when it was copied. Check the link, or start a new payment."
                  : error}
              </p>
              <Link href="/send" className="inline-flex min-h-11 items-center font-semibold text-primary-text underline underline-offset-4">
                Pay from your wallet
              </Link>
            </div>
          ) : (
            <Loader label="Loading payment" />
          )
        ) : p.status === "settled" ? (
          <>
            <Landed
              t={p}
              preview={false}
              returnTo={`/p/${token}`}
              actions={
                <ButtonLink href="/send" variant="secondary" className="w-full">
                  Pay someone else
                </ButtonLink>
              }
              aside={<EmailReceipt token={token} />}
            />
          </>
        ) : p.cross ? (
          <div className="enter space-y-4 pt-6 lg:max-w-md">
            <h1 className="text-title leading-tight font-extrabold">{p.cross.canPay ? `Pay from ${p.cross.chainName}` : "On its way to Arc"}</h1>
            <p className="text-muted-foreground">${p.amount}, from {p.cross.chainName}, paid out on Arc. This link keeps working if you close it.</p>
            {p.cross.canPay && burnSent(typeof window === "undefined" ? null : window.localStorage, token) ? (
              <Notice>{CROSS_WALLET_TEXT.sentWaiting(p.cross.chainName)}</Notice>
            ) : p.cross.canPay && p.cross.call && config ? (
              <div className="surface p-5">
                <CrossWalletSteps
                  config={config}
                  payment={p}
                  call={p.cross.call}
                  cost={null}
                  chainName={p.cross.chainName}
                  gas={config.crossPay?.chains.find((c) => c.key === p.cross?.chain)?.gas ?? "gas"}
                  onBurned={(hash) => void api("/api/visitor/burn", { body: { token, txHash: hash } }).then((r) => setP((r as { payment: VisitorPaymentView }).payment)).catch(() => undefined)}
                  onPending={() => setP({ ...p })}
                />
              </div>
            ) : (
              <CrossProgress cross={p.cross} payer={p.payer} config={config} />
            )}
          </div>
        ) : p.status === "verifying" ? (
          <div className="enter pt-6">
            <h1 className="text-title leading-tight font-extrabold">Sending…</h1>
            <p className="mt-1 text-white/70">${p.amount}, settling on Arc.</p>
            <StepList
              tone="night"
              className="surface-night mt-6 p-5"
              steps={STEPS.map((step) => ({ key: step.label, label: step.label, state: step.done(p.status) ? ("done" as const) : ("active" as const) }))}
            />
          </div>
        ) : p.status === "awaiting_wallet" ? (
          p.expiresAt && new Date(p.expiresAt) < new Date() ? (
            <Expired error={p.error} />
          ) : (
            <div className="enter space-y-3 pt-6">
              <h1 className="text-title leading-tight font-extrabold">Waiting for your wallet</h1>
              {p.error && <LastTry error={p.error} />}
              <p className="text-muted-foreground">
                Finish both steps on the page where you started. This page updates by itself as soon as the payment reaches Arc,
                and this link keeps working if you close it.
              </p>
              <Link href="/send" className="inline-flex min-h-11 items-center font-semibold text-primary-text underline underline-offset-4">
                Closed that page? Start again
              </Link>
            </div>
          )
        ) : p.status === "cancelled" && !p.txHash ? (
          <Expired error={p.error} />
        ) : (
          <div className="enter space-y-4 pt-6">
            <h1 className="text-title leading-tight font-extrabold">Not sent</h1>
            {p.error && (
              <Notice tone="error" className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {p.error}
              </Notice>
            )}
            <Link href="/send" className="inline-flex min-h-11 items-center font-semibold text-primary-text underline underline-offset-4">
              Back to Pay
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

/** Why the last send from this link didn't go through, while the person can still try again. */
function LastTry({ error }: { error: string }) {
  return (
    <Notice tone="error" className="flex items-start gap-2">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {error}
    </Notice>
  );
}

function Expired({ error }: { error?: string | null }) {
  return (
    <div className="enter space-y-3 pt-6">
      <h1 className="text-title leading-tight font-extrabold">This took longer than 30 minutes</h1>
      {error && <LastTry error={error} />}
      <p className="text-muted-foreground">
        No payment has reached Arc for this link yet. If you did send it, this page will show it as soon as it lands; otherwise,
        check the list again to pay.
      </p>
      <Link href="/send" className="inline-flex min-h-11 items-center font-semibold text-primary-text underline underline-offset-4">
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
    <form onSubmit={send} className="surface space-y-3 p-5">
      <Field label="Email me my receipt" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button type="submit" variant="secondary" className="w-full" busy={state.busy}>
        Send receipt
      </Button>
      {state.done && <Notice tone="success">Sent to {state.done}</Notice>}
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </form>
  );
}
