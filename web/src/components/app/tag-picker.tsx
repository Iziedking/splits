"use client";

import { AtSign } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export type TagStatus = "free" | "taken" | "format" | "reserved" | "checking" | null;

/** What the line under the field says, for each answer from /api/tags/check. */
export const TAG_STATUS: Record<Exclude<TagStatus, null | "checking">, (tag: string) => string> = {
  free: (tag) => `@${tag} is yours to take`,
  taken: () => "Already taken",
  format: () => "3–20 letters, numbers or _",
  reserved: () => "That tag isn't available",
};

const normalise = (v: string) => v.trim().replace(/^[@＠]/, "").toLowerCase();

export type TagFieldProps = {
  value: string;
  status: TagStatus;
  label?: string;
  onChange: (value: string) => void;
};

/** The field with a fixed @ in front, and a live line saying whether the tag can be had. */
export function TagField({ value, status, label = "Your Split tag", onChange }: TagFieldProps) {
  const id = React.useId();
  const tag = normalise(value);
  const line = status === "checking" ? "Checking…" : status ? TAG_STATUS[status](tag) : "3–20 letters, numbers or _";
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <div className="flex items-center rounded-sm bg-white/70 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring">
        <span className="pl-4 text-lg font-semibold text-muted-foreground" aria-hidden="true">
          @
        </span>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={21}
          aria-describedby={`${id}-status`}
          className="min-h-12 w-full bg-transparent px-1 py-3 text-lg font-semibold focus:outline-none"
        />
      </div>
      <p id={`${id}-status`} role="status" className={cn("text-sm", status === "free" ? "text-primary-text" : "text-muted-foreground")}>
        {line}
      </p>
    </div>
  );
}

/** Checks a tag as it's typed (debounced), so the button is only offered for a free tag. */
export function useTagCheck(value: string): TagStatus {
  const [status, setStatus] = React.useState<TagStatus>(null);
  React.useEffect(() => {
    const tag = normalise(value);
    if (!tag) return setStatus(null);
    if (!/^[a-z0-9_]{3,20}$/.test(tag)) return setStatus("format");
    setStatus("checking");
    let live = true;
    const timer = setTimeout(() => {
      api<{ status: Exclude<TagStatus, null | "checking"> }>(`/api/tags/check?tag=${encodeURIComponent(tag)}`)
        .then((r) => live && setStatus(r.status))
        .catch(() => live && setStatus(null));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [value]);
  return status;
}

/** The sign-up step: pick the tag people pay instead of your email. */
export function TagPicker({ suggestion, onClaimed }: { suggestion: string; onClaimed: () => void | Promise<void> }) {
  const [value, setValue] = React.useState(suggestion);
  const status = useTagCheck(value);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const tag = normalise(value);

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/tags", { body: { tag } });
      await onClaimed();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={claim} className="space-y-4">
      <AtSign className="h-8 w-8" aria-hidden="true" />
      <h1 className="text-title leading-tight font-extrabold">Pick your Split tag</h1>
      <p className="text-sm text-muted-foreground">People can pay you with your tag instead of your email.</p>
      <TagField value={value} status={status} onChange={setValue} />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" busy={busy} disabled={status !== "free" || busy}>
        {tag ? `Use @${tag}` : "Use this tag"}
      </Button>
      <p className="text-xs text-muted-foreground">You can change it 3 times.</p>
    </form>
  );
}
