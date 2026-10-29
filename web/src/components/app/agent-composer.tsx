"use client";

import { ImagePlus, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { inputClass, Notice } from "@/components/ui/field";
import { shrinkImage } from "@/lib/agent/resize";
import { api, errorMessage, type ComposerFill } from "@/lib/api";
import { cn } from "@/lib/utils";

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGES = 3;
type Shot = { id: number; blob: Blob; url: string };

/**
 * "Describe it, I split it": rough text and up to 3 screenshots in, a filled payout composer out.
 * What was typed and added stays here after any failure.
 */
export function AgentComposer({ onFilled, onBusy }: { onFilled: (fill: ComposerFill) => void; onBusy?: (busy: boolean) => void }) {
  const [text, setText] = React.useState("");
  const [shots, setShots] = React.useState<Shot[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const picker = React.useRef<HTMLInputElement>(null);
  const nextId = React.useRef(0);
  const shotsRef = React.useRef(shots);
  shotsRef.current = shots;
  /** Screenshots still being shrunk; counted so quick repeated pastes can't pass the limit. */
  const pending = React.useRef(0);

  React.useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  async function add(files: File[]) {
    setError(null);
    const images = files.filter((f) => TYPES.includes(f.type));
    if (images.length < files.length) setError("Screenshots must be PNG, JPEG or WebP images.");
    const room = Math.max(0, MAX_IMAGES - shotsRef.current.length - pending.current);
    if (images.length > room) setError(`Add up to ${MAX_IMAGES} screenshots.`);
    const taken = images.slice(0, room);
    pending.current += taken.length;
    for (const file of taken) {
      try {
        const blob = await shrinkImage(file);
        setShots((s) => [...s, { id: nextId.current++, blob, url: URL.createObjectURL(blob) }]);
      } catch {
        setError("Couldn't open that image. Try another screenshot.");
      } finally {
        pending.current--;
      }
    }
  }

  function remove(id: number) {
    setShots((s) => {
      const gone = s.find((x) => x.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return s.filter((x) => x.id !== id);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || (!text.trim() && shots.length === 0)) return;
    setBusy(true);
    onBusy?.(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("text", text);
      shots.forEach((s, i) => form.append("images", s.blob, `screenshot-${i + 1}.${s.blob.type.split("/")[1] ?? "png"}`));
      onFilled(await api<ComposerFill>("/api/agent/draft", { body: form }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="agent-text" className="mb-1.5 block text-sm font-medium">
          Describe it, Splits fills in the list
        </label>
        <textarea
          id="agent-text"
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              void add(files);
            }
          }}
          maxLength={4000}
          placeholder="Paste names, emails and amounts, or describe the split…"
          className={cn(inputClass, "min-h-40 py-3 leading-6 lg:text-sm")}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={picker}
          type="file"
          accept={TYPES.join(",")}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void add([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="secondary" className="min-h-11 px-4" disabled={shots.length >= MAX_IMAGES} onClick={() => picker.current?.click()}>
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          Add screenshots
        </Button>
        <ul className="flex gap-5" aria-label="Screenshots">
          {shots.map((s, i) => (
            <li key={s.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
              <img src={s.url} alt={`Screenshot ${i + 1}`} className="h-14 w-14 rounded-md object-cover ring-1 ring-white" />
              <button
                type="button"
                onClick={() => remove(s.id)}
                aria-label={`Remove screenshot ${i + 1}`}
                className="group absolute -top-3 -right-3 flex h-11 w-11 items-center justify-center focus-visible:outline-none"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background ring-2 ring-white group-focus-visible:ring-ring">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="sr-only" aria-live="polite">
        {busy ? "Reading your description" : ""}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" busy={busy} disabled={!text.trim() && shots.length === 0}>
        {busy ? "Reading…" : "Fill in the list"}
      </Button>
    </form>
  );
}
