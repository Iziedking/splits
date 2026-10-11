"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, inputClass, Notice } from "@/components/ui/field";
import { api, errorMessage, type PayoutCheck } from "@/lib/api";
import { cn } from "@/lib/utils";

const bytes = (s: string) => new TextEncoder().encode(s.trim()).length;

/**
 * Who gets paid and how much. One person is a one-line list, so both modes go through the same
 * server check. Any edit after a check clears it, so a stale list can never be approved.
 */
export function PayoutComposer({
  mode,
  initialLabel,
  onChecked,
}: {
  mode: "one" | "many";
  initialLabel: string;
  onChecked: (check: PayoutCheck | null) => void;
}) {
  const [who, setWho] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [text, setText] = React.useState("");
  const [split, setSplit] = React.useState<"equal" | "each">("equal");
  const [pot, setPot] = React.useState("");
  const [label, setLabel] = React.useState(initialLabel);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => setLabel(initialLabel), [initialLabel]);

  function edit<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setError(null);
      onChecked(null);
    };
  }

  const labelTooLong = bytes(label) > 31;
  const canCheck =
    !labelTooLong &&
    label.trim() !== "" &&
    (mode === "one" ? who.trim() !== "" && /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0 : text.trim() !== "" && (split === "each" || pot.trim() !== ""));

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!canCheck) return;
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "one"
          ? { mode: "each" as const, text: `${who.trim()}, ${amount}, ${label.trim()}`, label: label.trim() }
          : { mode: split, text, pot: split === "equal" ? pot : undefined, label: label.trim() };
      onChecked(await api<PayoutCheck>("/api/payouts/check", { body }));
    } catch (err) {
      setError(errorMessage(err));
      onChecked(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={check} className="space-y-5">
      {mode === "one" ? (
        <>
          <Field
            label="Email or Arc address"
            value={who}
            onChange={(e) => edit(setWho)(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            hint="No account needed. Money sent to an email waits in their Splits balance until they sign in."
          />
          <Field
            label="Amount (USDC)"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => edit(setAmount)(e.target.value.replace(/[^\d.]/g, ""))}
          />
        </>
      ) : (
        <>
          <div role="radiogroup" aria-label="How to share it" className="grid grid-cols-2 rounded-[14px] bg-secondary p-1">
            {(
              [
                ["equal", "Split a pot equally"],
                ["each", "Set each amount"],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={split === value}
                onClick={() => edit(setSplit)(value)}
                className={cn(
                  "min-h-11 rounded-[10px] px-2 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  split === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {text}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="payout-list" className="mb-1.5 block text-sm font-medium">
              People to pay
            </label>
            <textarea
              id="payout-list"
              rows={8}
              spellCheck={false}
              value={text}
              onChange={(e) => edit(setText)(e.target.value)}
              aria-describedby="payout-list-hint"
              placeholder={
                split === "equal"
                  ? "ada@example.com\n0x8f3c…a12b\nbola@example.com"
                  : "ada@example.com, 50, 1st place\n0x8f3c…a12b, 30, 2nd place\nbola@example.com, 20"
              }
              className={cn(inputClass, "min-h-44 py-3 font-mono text-sm leading-6")}
            />
            <p id="payout-list-hint" className="mt-1 text-sm text-muted-foreground">
              One person per line: an email or Arc address
              {split === "each" ? ", then the amount, then an optional label" : ", with an optional label after two commas"}.
            </p>
          </div>
          {split === "equal" && (
            <Field
              label="Pot to share (USDC)"
              inputMode="decimal"
              placeholder="100.00"
              value={pot}
              onChange={(e) => edit(setPot)(e.target.value.replace(/[^\d.]/g, ""))}
              hint="Everyone gets the same, to the cent. Any leftover cents go one each to the first people on the list."
            />
          )}
        </>
      )}
      <Field
        label={mode === "one" ? "What it's for" : "Label for everyone"}
        value={label}
        onChange={(e) => edit(setLabel)(e.target.value)}
        error={labelTooLong ? "Keep it under 32 characters" : null}
        hint="Saved with the payment on Arc, like a memo."
      />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" variant="secondary" className="w-full" busy={busy} disabled={!canCheck}>
        {mode === "one" ? "Check" : "Check list"}
      </Button>
    </form>
  );
}
