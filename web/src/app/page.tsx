"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Backdrop } from "@/components/app/backdrop";
import { WelcomePanel } from "@/components/app/welcome-panel";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { api, errorMessage, type Me, type UserView } from "@/lib/api";

type Step = "welcome" | "email" | "code";

/**
 * Welcome, then sign in with an email code (UI_BRIEF.md v4, frames "Welcome Page" and "Email/Sign
 * up"). The email is the account and the wallet, so new and returning people take the same path.
 * From `lg` up it is a split screen (v5, frames "MacBook Air - 1/2"): the panel left, these steps
 * right. No password field: sign-in is the emailed code (Google sign-in comes later).
 */
export default function SignIn() {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>("welcome");
  const [returning, setReturning] = React.useState(false);
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

  function start(existing: boolean) {
    setReturning(existing);
    setError(null);
    setStep("email");
  }

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
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-2">
      <WelcomePanel />
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-6 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] lg:px-10 lg:py-12">
        <Backdrop />
        <header className="flex items-center justify-between">
          <p className="text-xl font-extrabold tracking-tight">Splits</p>
          {/* Deliberately quiet: the welcome screen's job is getting started. */}
          <Link
            href="/about"
            className="-mr-2 inline-flex min-h-11 items-center rounded-full px-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            About
          </Link>
        </header>

        {step === "welcome" && (
          <section className="enter mt-auto lg:mb-auto">
            <h1 className="text-[2.6rem] leading-[1.08] font-extrabold">
              Send once.
              <br />
              It lands divided.
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              One payment from the UK or US to Nigeria, split to everyone it is meant for.
            </p>
            <div className="mt-10 space-y-3">
              <Button className="w-full" onClick={() => start(false)}>
                Get started
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => start(true)}>
                I already have an account
              </Button>
              <Link
                href="/send"
                className="flex min-h-11 items-center justify-center rounded-full text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Pay without an account
              </Link>
            </div>
          </section>
        )}

        {step === "email" && (
          <form onSubmit={sendCode} className="enter mt-10 flex flex-1 flex-col">
            <BackButton onClick={() => setStep("welcome")} />
            <h1 className="mt-4 text-[2rem] leading-tight font-extrabold">{returning ? "Welcome back" : "Create an account"}</h1>
            <p className="mt-2 text-muted-foreground">
              {returning ? "Sign in with the email you used before." : "Your email is your account and your wallet. No password to remember."}
            </p>
            <div className="surface mt-6 p-5">
              <Field
                label="Email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                hint="We'll email you a 6-digit code."
              />
            </div>
            {error && <Notice tone="error" className="mt-4">{error}</Notice>}
            <div className="mt-auto space-y-3 pt-8">
              <Button type="submit" className="w-full" busy={busy}>
                Continue
              </Button>
              <Button type="button" variant="secondary" className="w-full" onClick={() => setReturning(!returning)}>
                {returning ? "New here? Create an account" : "Have an account? Sign in"}
              </Button>
            </div>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={verify} className="enter mt-10 flex flex-1 flex-col">
            <BackButton
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            />
            <h1 className="mt-4 text-[2rem] leading-tight font-extrabold">Check your email</h1>
            <p className="mt-2 text-muted-foreground">
              We sent a code to <span className="font-semibold text-foreground">{email}</span>.
            </p>
            {previewCode && (
              <Notice className="mt-4">
                This server doesn&apos;t send email. Your code is <strong className="text-foreground">{previewCode}</strong>.
              </Notice>
            )}
            <div className="surface mt-6 p-5">
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
            </div>
            {error && <Notice tone="error" className="mt-4">{error}</Notice>}
            <div className="mt-auto pt-8">
              <Button type="submit" className="w-full" busy={busy} disabled={code.length !== 6}>
                Continue
              </Button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-2 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back
    </button>
  );
}
