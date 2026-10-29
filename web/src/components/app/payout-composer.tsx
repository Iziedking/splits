"use client";

import * as React from "react";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Field, inputClass, Notice } from "@/components/ui/field";
import { api, errorMessage, type ComposerFill, type PayoutCheck } from "@/lib/api";
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
  checkPath = "/api/payouts/check",
  fill = null,
}: {
  mode: "one" | "many";
  initialLabel: string;
  onChecked: (check: PayoutCheck | null) => void;
  /** Visitors check through /api/visitor/check; accounts use the default. */
  checkPath?: string;
  /** A list drafted by agentic mode; applied once per id, with Undo. */
  fill?: (ComposerFill & { id: number }) | null;
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

  type Snapshot = { text: string; split: "equal" | "each"; pot: string; label: string };
  const [filled, setFilled] = React.useState<{ notes: string[]; before: Snapshot } | null>(null);
  const current = React.useRef<Snapshot>({ text, split, pot, label });
  current.current = { text, split, pot, label };

  React.useEffect(() => {
    if (!fill || mode !== "many") return;
    setFilled({ notes: fill.notes, before: current.current });
    setText(fill.text);
    setSplit(fill.mode);
    setPot(fill.pot);
    if (fill.label) setLabel(fill.label);
    setError(null);
    onChecked(null);
    // Applied once per drafted list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill?.id]);

  function undo() {
    if (!filled) return;
    const b = filled.before;
    setText(b.text);
    setSplit(b.split);
    setPot(b.pot);
    setLabel(b.label);
    setFilled(null);
    setError(null);
    onChecked(null);
  }

  function edit<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setError(null);
      onChecked(null);
    };
  }

  const labelTooLong = bytes(label) > 31;
  const waitingId = React.useId();
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
      onChecked(await api<PayoutCheck>(checkPath, { body }));
    } catch (err) {
      setError(errorMessage(err));
      onChecked(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={check} className="space-y-5">
      {/* Mounted before any fill, so screen readers announce the result. */}
      <p className="sr-only" aria-live="polite">
        {filled ? "Filled from your description. Check every line before you continue." : ""}
      </p>
      {filled && (
        <Notice>
          <span className="block font-semibold text-foreground">Filled from your description. Check every line before you continue.</span>
          {filled.notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {filled.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={undo} className="mt-2 min-h-11 font-semibold text-primary-text underline underline-offset-4">
            Undo
          </button>
        </Notice>
      )}
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
          <Segmented
            kind="radio"
            label="How to share it"
            options={[
              { value: "equal", label: "Split equally" },
              { value: "each", label: "Set amounts" },
            ]}
            value={split}
            onChange={(next) => edit(setSplit)(next)}
          />
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
              className={cn(inputClass, "min-h-44 py-3 font-mono leading-6 lg:text-sm")}
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
      <Button type="submit" variant="secondary" className="w-full" busy={busy} disabled={!canCheck} aria-describedby={canCheck ? undefined : waitingId}>
        {mode === "one" ? "Check" : "Check list"}
      </Button>
      {!canCheck && !labelTooLong && (
        <p id={waitingId} className="text-center text-sm text-muted-foreground">
          {mode === "one"
            ? "Add who to pay, an amount and what it's for, then check."
            : split === "equal"
              ? "Add your list, the amount to split and a label, then check."
              : "Add your list and a label, then check."}
        </p>
      )}
    </form>
  );
}
