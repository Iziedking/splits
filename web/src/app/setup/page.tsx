"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";

export default function SetupPage() {
  return (
    <AppFrame requirePin={false}>
      <Setup />
    </AppFrame>
  );
}

/** Every payment is approved with this PIN, or with Face ID or fingerprint once added. */
function Setup() {
  const router = useRouter();
  const { me, refresh } = useMe();
  const [pin, setPin] = React.useState("");
  const [again, setAgain] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [passkeySupported, setPasskeySupported] = React.useState(false);

  React.useEffect(() => setPasskeySupported(browserSupportsWebAuthn()), []);

  async function savePin(e: React.FormEvent) {
    e.preventDefault();
    if (pin !== again) {
      setError("The two PINs don't match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/security/pin", { body: { pin } });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey() {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
        "/api/security/passkey/options",
        { method: "POST" },
      );
      const response = await startRegistration({ optionsJSON });
      await api("/api/security/passkey/verify", { body: { response } });
      await refresh();
      router.replace("/home");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

  return (
    <div className="enter mx-auto mt-6 max-w-sm rounded-2xl bg-card p-6 shadow-lg">
      {!me.user.hasPin ? (
        <form onSubmit={savePin} className="space-y-4">
          <ShieldCheck className="h-8 w-8" aria-hidden="true" />
          <h1 className="text-2xl font-bold tracking-tight">Choose a payment PIN</h1>
          <p className="text-sm text-muted-foreground">
            You'll enter it to approve every payment. Five wrong tries locks payments for 15 minutes.
          </p>
          <Field
            label="New PIN"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(digits(e.target.value))}
            hint="6 digits, not a repeated or straight sequence"
          />
          <Field
            label="Enter it again"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={again}
            onChange={(e) => setAgain(digits(e.target.value))}
          />
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" className="w-full" busy={busy} disabled={pin.length !== 6 || again.length !== 6}>
            Save PIN
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <Fingerprint className="h-8 w-8" aria-hidden="true" />
          <h1 className="text-2xl font-bold tracking-tight">Approve with Face ID or fingerprint</h1>
          <p className="text-sm text-muted-foreground">
            Faster than typing your PIN. Your PIN keeps working as a backup.
          </p>
          {!passkeySupported && <Notice>This browser can't use Face ID or fingerprint. You can add it later on your phone.</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {passkeySupported && !me.user.hasPasskey && (
            <Button className="w-full" busy={busy} onClick={() => void addPasskey()}>
              Turn on Face ID or fingerprint
            </Button>
          )}
          <Button variant={passkeySupported ? "ghost" : "primary"} className="w-full" onClick={() => router.replace("/home")}>
            {me.user.hasPasskey ? "Continue" : "Not now"}
          </Button>
        </div>
      )}
    </div>
  );
}
