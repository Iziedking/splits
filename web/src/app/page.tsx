"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { SplitStream } from "@/components/app/split-stream";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { api, errorMessage, type Me, type UserView } from "@/lib/api";

const HERO = [
  { label: "Rent", weight: 40 },
  { label: "School fees", weight: 35 },
  { label: "Upkeep", weight: 25 },
];

/** Sign in with an email code. The email is the account and the wallet; there is nothing else to set up. */
export default function SignIn() {
  const router = useRouter();
  const [step, setStep] = React.useState<"email" | "code">("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [previewCode, setPreviewCode] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
    <main className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:px-8">
      <section>
        <p className="display-face text-2xl font-bold tracking-tight">Splits</p>
        <h1 className="mt-8 max-w-xl text-[2.6rem] leading-[1.02] font-bold sm:text-6xl">Split any payment, to anyone.</h1>
        <p className="mt-5 max-w-md text-lg leading-relaxed text-muted-foreground">
          Send money home already divided into rent, school fees and upkeep. Pay twenty giveaway winners in one go.
          Everyone gets their exact share, with a receipt that says what it was for.
        </p>
        <SplitStream branches={HERO} stage="done" intro className="mt-8 w-full max-w-lg text-foreground" />
      </section>

      <section className="surface w-full max-w-md justify-self-center p-7 lg:justify-self-end">
        {step === "email" ? (
          <form onSubmit={sendCode} className="space-y-5">
            <h2 className="text-2xl font-bold">Sign in or create an account</h2>
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              hint="We'll email you a 6-digit code. Your email is your account and your wallet."
            />
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" className="w-full" busy={busy}>
              Email me a code
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-5">
            <h2 className="text-2xl font-bold">Check your email</h2>
            <p className="text-muted-foreground">
              We sent a code to <span className="font-semibold text-foreground">{email}</span>.
            </p>
            {previewCode && (
              <Notice>
                This server doesn't send email. Your code is <strong className="text-foreground">{previewCode}</strong>.
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
              className="[&_input]:text-center [&_input]:text-2xl [&_input]:tracking-[0.4em]"
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
      </section>
    </main>
  );
}
