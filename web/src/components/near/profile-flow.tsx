"use client";

import { Camera, LogOut, Trash2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { Avatar } from "./avatar";
import { useNearWallet } from "./wallet";

const MAX_CHARS = 80_000;

/** Crops the middle square of a picture and shrinks it until it fits the server's limit. */
async function squarePicture(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  for (const [px, type, quality] of [
    [256, "image/webp", 0.85],
    [256, "image/webp", 0.7],
    [192, "image/jpeg", 0.75],
    [128, "image/jpeg", 0.7],
  ] as const) {
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const g = canvas.getContext("2d");
    if (!g) break;
    g.drawImage(bitmap, sx, sy, side, side, 0, 0, px, px);
    const url = canvas.toDataURL(type, quality);
    // Browsers without WebP encoding hand back PNG; the loop moves on to JPEG if that is too big.
    if (url.length <= MAX_CHARS) return url;
  }
  throw new Error("That picture is too detailed to use. Try another one.");
}

export function ProfileFlow() {
  const { accountId, kind, email, avatar, setAvatar, signIn, signOut } = useNearWallet();
  const [busy, setBusy] = React.useState<"saving" | "removing" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showAddress, setShowAddress] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  if (!accountId) {
    return (
      <section className="surface max-w-xl rounded-2xl p-6 sm:p-7">
        <p className="text-muted-foreground">Sign in to see your profile.</p>
        <Button className="mt-4" onClick={() => void signIn().catch(() => {})}>
          Sign in
        </Button>
      </section>
    );
  }

  const label = email ?? accountId;

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(file.type)) return setError("Choose a photo: JPG, PNG or WebP.");
    if (file.size > 15 * 1024 * 1024) return setError("That file is over 15 MB. Choose a smaller photo.");
    setBusy("saving");
    try {
      const image = await squarePicture(file);
      const res = await fetch("/api/near/profile/avatar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? "Your picture was not saved. Try again.");
      setAvatar(image);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your picture was not saved. Try again.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function onRemove() {
    setError(null);
    setBusy("removing");
    try {
      const res = await fetch("/api/near/profile/avatar", { method: "DELETE" });
      if (!res.ok) throw new Error("Your picture was not removed. Try again.");
      setAvatar(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your picture was not removed. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="surface max-w-xl rounded-2xl p-6 sm:p-7" aria-labelledby="profile-title">
      <div className="flex flex-col items-center text-center sm:flex-row sm:items-center sm:gap-6 sm:text-left">
        <Avatar label={label} src={avatar} size="lg" className="ring-4" />
        <div className="mt-4 min-w-0 sm:mt-0">
          <h2 id="profile-title" className="truncate text-xl font-semibold">
            {label}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{kind === "email" ? "Signed in with your email" : "Signed in with a NEAR wallet"}</p>
        </div>
      </div>

      {kind === "email" ? (
        <div className="mt-6 flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/*" className="sr-only" id="picture" onChange={(e) => void onPick(e.target.files?.[0])} />
          <Button busy={busy === "saving"} onClick={() => input.current?.click()}>
            <Camera className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            {avatar ? "Change picture" : "Add a picture"}
          </Button>
          {avatar && (
            <Button variant="secondary" busy={busy === "removing"} onClick={() => void onRemove()}>
              <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              Remove picture
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">A profile picture needs an email sign-in for now. Your round badge shows two letters of your account.</p>
      )}
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}

      <div className="mt-6 border-t border-foreground/8 pt-5">
        <p className="text-sm font-semibold">Your Splits account</p>
        <p className="mt-1 text-sm text-muted-foreground">People can pay you by your email{kind === "email" ? "" : " once you sign in with one"}, or by this address.</p>
        <button type="button" className="mt-2 text-sm font-semibold text-primary-text underline underline-offset-2" aria-expanded={showAddress} onClick={() => setShowAddress((s) => !s)}>
          {showAddress ? "Hide the address" : "Show the address"}
        </button>
        {showAddress && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white/70 px-3 py-2 font-mono text-micro break-all ring-1 ring-white">{accountId}</code>
            <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(accountId)}>
              Copy
            </Button>
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-foreground/8 pt-5">
        <Button variant="secondary" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </section>
  );
}
