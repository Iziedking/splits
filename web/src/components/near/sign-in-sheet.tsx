"use client";

import * as React from "react";
import { Sheet } from "@/components/app/sheet";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/field";
import { CodeBoxes } from "./code-boxes";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? "Something went wrong. Try again.");
  return data;
}

/**
 * Sign in the way any app does: an email, then the 6-digit code sent to it. Splits makes the
 * account behind it. People who already have a NEAR wallet can use that instead.
 */
export function SignInSheet({
  open,
  onClose,
  onSignedIn,
  onWallet,
}: {
  open: boolean;
  onClose: () => void;
  onSignedIn: (r: { accountId: string; email: string }) => void;
  onWallet: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [hint, setHint] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setCode("");
      setSent(false);
      setHint(null);
      setError(null);
    }
  }, [open]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ previewCode?: string }>("/api/near/auth/start", { email });
      setSent(true);
      setHint(r.previewCode ? `Test mode: your code is ${r.previewCode}` : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    await verifyCode(code);
  }

  // The last box filled signs in straight away, the way phone apps do.
  async function verifyCode(code: string) {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await post<{ accountId: string; email: string }>("/api/near/auth/verify", { email, code }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Sign in" description={sent ? `We sent a 6-digit code to ${email}.` : "Use your email. We will send you a code; no password."}>
      {!sent ? (
        <form onSubmit={sendCode} className="space-y-4">
          <Field label="Email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <Button type="submit" className="w-full" busy={busy} disabled={!email.includes("@")}>
            Send me a code
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">Code</p>
            <CodeBoxes value={code} onChange={(c) => (setCode(c), setError(null))} onComplete={(c) => void verifyCode(c)} />
            <p className="mt-2 text-sm text-muted-foreground">{hint ?? "It can take a minute. Check your spam folder too."}</p>
          </div>
          <Button type="submit" className="w-full" busy={busy} disabled={code.length !== 6}>
            Sign in
          </Button>
          <button type="button" className="min-h-11 text-sm font-medium text-primary-text underline-offset-4 hover:underline" onClick={() => (setSent(false), setCode(""))}>
            Use a different email
          </button>
        </form>
      )}
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
      <p className="mt-5 border-t border-border pt-4 text-center text-sm text-muted-foreground">
        <button type="button" className="min-h-11 font-medium underline-offset-4 hover:text-foreground hover:underline" onClick={onWallet}>
          I already have a NEAR wallet
        </button>
      </p>
    </Sheet>
  );
}
