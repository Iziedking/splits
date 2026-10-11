"use client";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { ExternalLink, Fingerprint, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AddMoney, AddressQr } from "@/components/app/add-money";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { CopyAddress } from "@/components/app/copy-address";
import { Ribbon } from "@/components/app/ribbon";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { api, errorMessage, type SplitView } from "@/lib/api";
import { registerPasskey } from "@/lib/passkey";

export default function ProfilePage() {
  return (
    <AppFrame>
      <Profile />
    </AppFrame>
  );
}

function Profile() {
  const router = useRouter();
  const { me, refresh } = useMe();
  const main = me.wallets.find((w) => w.kind === "main");
  const [adding, setAdding] = React.useState(false);
  const [rule, setRule] = React.useState<SplitView | null | undefined>(undefined);

  React.useEffect(() => {
    api<{ splits: SplitView[] }>("/api/splits")
      .then((r) => setRule(r.splits.find((s) => s.automatic && s.status !== "failed") ?? null))
      .catch(() => setRule(null));
  }, []);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/");
  }

  return (
    <div className="enter grid gap-6 pt-2 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
      <div className="space-y-6">
        <h1 className="text-4xl font-bold">Profile</h1>

        {main && (
          <section aria-labelledby="address-heading" className="surface p-6">
            <h2 id="address-heading" className="text-xl font-bold">
              Your wallet address
            </h2>
            <p className="mt-1 text-muted-foreground">
              Anyone can pay you here with USDC on {me.network === "arc" ? "Arc" : "Arc Testnet"}. Your email works too, for
              people using Splits.
            </p>
            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
              <AddressQr address={main.address} size={160} />
              <div className="min-w-0 space-y-3">
                <code className="block text-sm break-all">{main.address}</code>
                <div className="flex flex-wrap gap-2">
                  <CopyAddress address={main.address} tone="dark" />
                  <Button variant="secondary" className="min-h-11" onClick={() => setAdding(true)}>
                    <Wallet className="h-4 w-4" aria-hidden="true" />
                    Add money
                  </Button>
                </div>
                {main.explorerUrl && (
                  <a
                    href={main.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline underline-offset-4"
                  >
                    See it on the Arc explorer
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
          </section>
        )}

        <section aria-labelledby="auto-heading" className="surface p-6">
          <h2 id="auto-heading" className="text-xl font-bold">
            Automatic split
          </h2>
          {rule === undefined ? (
            <div aria-busy="true" className="mt-3 h-10 rounded-[14px] bg-muted motion-safe:animate-pulse" />
          ) : rule ? (
            <>
              <p className="mt-1 text-muted-foreground">{rule.name}. Runs by itself on every payment that reaches your wallet.</p>
              <Ribbon className="mt-4" parts={rule.legs.map((l) => ({ label: l.name, weight: l.percent ?? 0 }))} />
            </>
          ) : (
            <>
              <p className="mt-1 text-muted-foreground">Put part of every payment you receive into savings, automatically.</p>
              <Link
                href="/rules/new"
                className="mt-4 inline-flex min-h-11 items-center rounded-[14px] px-4 text-sm font-semibold ring-1 ring-border hover:ring-ring/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Set it up
              </Link>
            </>
          )}
        </section>
      </div>

      <div className="space-y-6 lg:pt-14">
        <section aria-labelledby="account-heading" className="surface p-6">
          <h2 id="account-heading" className="text-xl font-bold">
            Account
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate font-medium">{me.user.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Network</dt>
              <dd className="font-medium">
                {me.mode === "preview" ? "Preview (simulated)" : me.network === "arc" ? "Arc" : "Arc Testnet, test money with no value"}
              </dd>
            </div>
          </dl>
          <Button variant="secondary" className="mt-5 w-full" onClick={() => void signOut()}>
            Sign out
          </Button>
        </section>

        <ChangePin />
        <Passkey hasPasskey={me.user.hasPasskey} onAdded={refresh} />
      </div>

      {main && <AddMoney address={main.address} network={me.network} open={adding} onClose={() => setAdding(false)} />}
    </div>
  );
}

function ChangePin() {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      await api("/api/security/pin/change", { body: { currentPin: current, newPin: next } });
      setResult({ ok: true, text: "PIN changed. Use the new one from now on." });
      setCurrent("");
      setNext("");
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="pin-heading" className="surface p-6">
      <h2 id="pin-heading" className="text-xl font-bold">
        Change PIN
      </h2>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field
          label="Current PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={current}
          onChange={(e) => setCurrent(digits(e.target.value))}
        />
        <Field
          label="New PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={next}
          onChange={(e) => setNext(digits(e.target.value))}
          hint="6 digits, not a repeated or straight sequence."
        />
        {result && <Notice tone={result.ok ? "success" : "error"}>{result.text}</Notice>}
        <Button type="submit" className="w-full" busy={busy} disabled={current.length !== 6 || next.length !== 6}>
          Change PIN
        </Button>
      </form>
    </section>
  );
}

function Passkey({ hasPasskey, onAdded }: { hasPasskey: boolean; onAdded: () => Promise<void> }) {
  const [supported, setSupported] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey();
      await onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="passkey-heading" className="surface p-6">
      <h2 id="passkey-heading" className="text-xl font-bold">
        Face ID or fingerprint
      </h2>
      {hasPasskey ? (
        <p className="mt-1 text-muted-foreground">On. You can approve payments without typing your PIN.</p>
      ) : supported ? (
        <>
          <p className="mt-1 text-muted-foreground">Approve payments with a glance or a touch. Your PIN still works.</p>
          {error && <Notice tone="error" className="mt-3">{error}</Notice>}
          <Button variant="secondary" className="mt-4 w-full" busy={busy} onClick={() => void add()}>
            <Fingerprint className="h-4 w-4" aria-hidden="true" />
            Add Face ID or fingerprint
          </Button>
        </>
      ) : (
        <p className="mt-1 text-muted-foreground">This browser can&apos;t use Face ID or fingerprint. Try on your phone.</p>
      )}
    </section>
  );
}
