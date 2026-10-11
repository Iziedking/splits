"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { api, errorMessage, type Me, type UserView } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";

/** Sign in with an email code. The email is the account and the wallet; there is nothing else to set up. */
export default function SignIn() {
  const router = useRouter();
  const [step, setStep] = React.useState<"email" | "code">("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [previewCode, setPreviewCode] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Already signed in: go straight to the app.
  React.useEffect(() => {
    api<Me>("/api/me")
      .then((me) => router.replace(me.user.hasPin ? "/home" : "/setup"))
      .catch(() => undefined);
  }, [router]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ previewCode?: string }>("/api/auth/start", { body: { email } });
      setPreviewCode(res.previewCode ?? null);
      setStep("code");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: UserView }>("/api/auth/verify", { body: { email, code } });
      router.replace(res.user.hasPin ? "/home" : "/setup");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-4 py-12">
      <div className="enter max-w-md text-center">
        <p className="text-lg font-bold tracking-tight">Splits</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Send money home with its purpose built in.</h1>
        <p className="mt-4 text-muted-foreground">
          One payment, already divided: rent to the landlord, fees to the school, the rest to family. Each part
          arrives with a receipt saying what it was for.
        </p>
      </div>

      <div className="enter w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg [animation-delay:60ms]">
        {step === "email" ? (
          <form onSubmit={sendCode} className="space-y-4">
            <h2 className="text-lg font-medium text-muted-foreground">Sign in or create an account</h2>
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              hint="We'll email you a 6-digit code. No password, no seed phrase."
            />
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" className="w-full" busy={busy}>
              Email me a code
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <h2 className="text-lg font-medium text-muted-foreground">Check your email</h2>
            <p className="text-sm text-muted-foreground">
              We sent a code to <span className="font-medium text-foreground">{email}</span>.
            </p>
            {previewCode && (
              <Notice>
                Preview mode sends no email. Your code is <strong className="text-foreground">{previewCode}</strong>.
              </Notice>
            )}
            <Field
              label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" className="w-full" busy={busy} disabled={code.length !== 6}>
              Continue
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              Use a different email
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
