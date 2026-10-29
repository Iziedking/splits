"use client";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { Switch } from "@/components/app/switch";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";
import { registerPasskey } from "@/lib/passkey";

export default function SettingsPage() {
  return (
    <AppFrame>
      <Settings />
    </AppFrame>
  );
}

/**
 * How Splits treats you (UI_BRIEF.md v5: the rail's Settings; on a phone, linked from Profile):
 * email alerts, the PIN that approves payments, and Face ID or fingerprint.
 */
function Settings() {
  const { me, refresh } = useMe();
  return (
    <div className="enter space-y-6 pt-4">
      <h1 className="text-title leading-tight font-extrabold">Settings</h1>
      <section aria-labelledby="alerts-heading" className="surface p-6">
        <h2 id="alerts-heading" className="text-lg font-extrabold">
          Notifications
        </h2>
        <p className="mt-1 text-muted-foreground">Everything shows in the app. Choose whether the important moments also come by email.</p>
        <EmailAlertsSwitch on={me.user.emailAlerts} onChanged={refresh} />
      </section>
      <ChangePin />
      <Passkey hasPasskey={me.user.hasPasskey} onAdded={refresh} />
      <nav aria-label="Help and legal" className="flex flex-wrap gap-x-5 text-sm font-semibold text-primary-text">
        <Link href="/help" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
          Help
        </Link>
        <Link href="/legal/terms" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
          Terms of use
        </Link>
        <Link href="/legal/privacy" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
          Privacy notice
        </Link>
      </nav>
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
      <h2 id="pin-heading" className="text-lg font-extrabold">
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
  const [pin, setPin] = React.useState("");
  React.useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey(pin);
      setPin("");
      await onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="passkey-heading" className="surface p-6">
      <h2 id="passkey-heading" className="text-lg font-extrabold">
        Face ID or fingerprint
      </h2>
      {hasPasskey ? (
        <p className="mt-1 text-muted-foreground">On. You can approve payments without typing your PIN.</p>
      ) : supported ? (
        <>
          <p className="mt-1 text-muted-foreground">Approve payments with a glance or a touch. Your PIN still works.</p>
          <Field
            className="mt-4"
            label="Your PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            hint="Adding Face ID or fingerprint is approved with your PIN."
          />
          {error && <Notice tone="error" className="mt-3">{error}</Notice>}
          <Button variant="secondary" className="mt-4 w-full" busy={busy} disabled={pin.length !== 6} onClick={() => void add()}>
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

/** "Email me about my money": deposits ready or waiting, payments landed or failed. */
function EmailAlertsSwitch({ on, onChanged }: { on: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/me/settings", { body: { emailAlerts: !on } });
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4">
      <Switch
        checked={on}
        onChange={() => void toggle()}
        disabled={busy}
        label="Email me about my money"
        description="Money added, payments landed or failed."
      />
      {error && <Notice tone="error" className="mt-2">{error}</Notice>}
    </div>
  );
}
