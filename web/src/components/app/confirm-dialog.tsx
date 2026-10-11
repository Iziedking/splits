"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, X } from "lucide-react";
import * as React from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { inputClass, Notice } from "@/components/ui/field";

export type Proof = { pin: string } | { passkey: unknown };

export interface ConfirmDialogProps {
  /** The pending action to approve; the dialog is open while this is set. */
  actionId: string | null;
  title: string;
  hasPasskey: boolean;
  /** What the person is approving, shown above the PIN. */
  children: React.ReactNode;
  /** Sends the proof to the server. Throw to keep the dialog open with the error. */
  onConfirm: (proof: Proof) => Promise<void>;
  onClose: () => void;
}

/**
 * The approval step for anything that moves money or goes onchain. PIN always works; Face ID or
 * fingerprint appears when the person has added a passkey. Built on <dialog> for focus handling.
 */
export function ConfirmDialog({ actionId, title, hasPasskey, children, onConfirm, onClose }: ConfirmDialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const pinRef = React.useRef<HTMLInputElement>(null);
  const [pin, setPin] = React.useState("");
  const [busy, setBusy] = React.useState<"pin" | "passkey" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (actionId && !dialog.open) {
      setPin("");
      setError(null);
      dialog.showModal();
      // showModal focuses the first focusable element (the close button); the PIN is what's needed.
      pinRef.current?.focus();
    }
    if (!actionId && dialog.open) dialog.close();
  }, [actionId]);

  async function submit(proof: Proof, kind: "pin" | "passkey") {
    setBusy(kind);
    setError(null);
    try {
      await onConfirm(proof);
    } catch (err) {
      setError(errorMessage(err));
      if (kind === "pin") setPin("");
      if (err instanceof ApiError && (err.code === "ACTION_EXPIRED" || err.code === "ALREADY_CONFIRMED")) {
        setPin("");
      }
    } finally {
      setBusy(null);
    }
  }

  async function usePasskey() {
    if (!actionId) return;
    setBusy("passkey");
    setError(null);
    try {
      const optionsJSON = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
        `/api/actions/${actionId}/passkey-options`,
        { method: "POST" },
      );
      const passkey = await startAuthentication({ optionsJSON });
      await submit({ passkey }, "passkey");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  function onPinChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setPin(digits);
    if (digits.length === 6 && !busy) void submit({ pin: digits }, "pin");
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="confirm-title"
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/40 open:motion-safe:animate-[settle_200ms_ease-out]"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="confirm-title" className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Cancel"
            className="-m-2 rounded-full p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4">{children}</div>

        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (pin.length === 6) void submit({ pin }, "pin");
          }}
        >
          <label htmlFor="confirm-pin" className="mb-1.5 block text-sm font-medium">
            Enter your 6-digit PIN
          </label>
          <input
            ref={pinRef}
            id="confirm-pin"
            className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => onPinChange(e.target.value)}
            disabled={busy !== null}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "confirm-error" : undefined}
          />
          {error && (
            <div id="confirm-error" className="mt-3">
              <Notice tone="error">{error}</Notice>
            </div>
          )}
          <Button type="submit" className="mt-4 w-full" busy={busy === "pin"} disabled={pin.length !== 6}>
            Confirm
          </Button>
        </form>

        {hasPasskey && (
          <Button variant="secondary" className="mt-3 w-full" onClick={() => void usePasskey()} busy={busy === "passkey"}>
            <Fingerprint className="h-4 w-4" aria-hidden="true" />
            Use Face ID or fingerprint
          </Button>
        )}
      </div>
    </dialog>
  );
}
