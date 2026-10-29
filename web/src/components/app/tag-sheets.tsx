"use client";

import { QrCode, Share2 } from "lucide-react";
import * as React from "react";
import { Qr } from "@/components/app/address-qr";
import { ConfirmDialog, type Proof } from "@/components/app/confirm-dialog";
import { CopyButton } from "@/components/app/copy-address";
import { Sheet } from "@/components/app/sheet";
import { TagField, useTagCheck } from "@/components/app/tag-picker";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";

export const shareText = (tag: string) => `Pay me on Splits: @${tag}`;
export const tagPageUrl = (origin: string, tag: string) => `${origin.replace(/\/+$/, "")}/@${tag}`;

/** The phone's share sheet where there is one; otherwise the text goes to the clipboard. */
async function share(text: string, url?: string) {
  try {
    if (navigator.share) return await navigator.share({ text, url });
    await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
  } catch {
    // Cancelled, or no clipboard: nothing to do.
  }
}

/** Profile's tag: the tag, ways to hand it out, and the change (while any are left). */
export function TagBlock({ tag, changesLeft, onChange, onQr }: { tag: string; changesLeft: number; onChange: () => void; onQr: () => void }) {
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 text-2xl font-extrabold break-all">@{tag}</p>
        <CopyButton value={`@${tag}`} shown="Copy tag" what="tag" tone="dark" />
      </div>
      <p className="text-sm text-muted-foreground">People can pay you with this tag instead of your email.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void share(shareText(tag))}>
          <Share2 className="h-4 w-4" aria-hidden="true" />
          Share
        </Button>
        <Button variant="secondary" size="sm" onClick={onQr}>
          <QrCode className="h-4 w-4" aria-hidden="true" />
          Show QR
        </Button>
        {changesLeft > 0 ? (
          <Button variant="ghost" size="sm" onClick={onChange}>
            Change tag ({changesLeft} of 3 left)
          </Button>
        ) : (
          <p className="self-center text-sm text-muted-foreground">Your tag can&apos;t be changed again</p>
        )}
      </div>
    </div>
  );
}

/** The tag's page as a QR code, with the link to copy or share. */
export function TagQrSheet({ open, onClose, tag, origin }: { open: boolean; onClose: () => void; tag: string; origin: string }) {
  const url = tagPageUrl(origin, tag);
  return (
    <Sheet open={open} onClose={onClose} title={`@${tag}`} description="Anyone can scan this to pay you.">
      <div className="mt-4 flex flex-col items-center gap-4">
        <Qr value={url} size={208} label={`QR code of the page for @${tag}`} />
        <p className="text-sm break-all text-muted-foreground">{url}</p>
        <div className="flex w-full flex-col gap-3 sm:flex-row">
          <CopyButton value={url} shown="Copy link" what="link" tone="dark" className="sm:flex-1" />
          <Button variant="secondary" className="sm:flex-1" onClick={() => void share(shareText(tag), url)}>
            <Share2 className="h-4 w-4" aria-hidden="true" />
            Share
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** A new tag, then the PIN or Face ID: changing how people pay you is approved like a payment. */
export function ChangeTagSheet({
  open,
  onClose,
  current,
  changesLeft,
  hasPasskey,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  current: string;
  changesLeft: number;
  hasPasskey: boolean;
  onChanged: () => Promise<void>;
}) {
  const [value, setValue] = React.useState("");
  const status = useTagCheck(value);
  const [pending, setPending] = React.useState<{ actionId: string; tag: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ action: { id: string }; tag: string }>("/api/tags/change", { body: { tag: value } });
      setPending({ actionId: res.action.id, tag: res.tag });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(proof: Proof) {
    if (!pending) return;
    await api("/api/tags/change/confirm", { body: { actionId: pending.actionId, ...proof } });
    setPending(null);
    setValue("");
    await onChanged();
    onClose();
  }

  return (
    <>
      <Sheet open={open && !pending} onClose={onClose} title="Change your tag" description={`Now @${current}. ${changesLeft} of 3 changes left.`}>
        <form onSubmit={start} className="mt-4 space-y-4">
          <TagField value={value} status={status} label="New tag" onChange={setValue} />
          <Notice>Your old tag stops working for good, and nobody else can ever take it.</Notice>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" className="w-full" busy={busy} disabled={status !== "free" || busy}>
            Continue
          </Button>
        </form>
      </Sheet>
      <ConfirmDialog actionId={pending?.actionId ?? null} title="Change your tag" hasPasskey={hasPasskey} onConfirm={confirm} onClose={() => setPending(null)}>
        <p className="text-lg font-semibold">
          @{current} → @{pending?.tag}
        </p>
      </ConfirmDialog>
    </>
  );
}
