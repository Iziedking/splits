"use client";

import { Notice } from "@/components/ui/field";

/** Seconds between codes, so a tap that seems to do nothing isn't repeated into the hourly limit. */
export const RESEND_WAIT_S = 30;

/** Under the code box: a new code (after a short wait), and a way back to fix a mistyped email. */
export function CodeHelp({
  email,
  secondsLeft,
  sending,
  sentAgain,
  onResend,
  onChangeEmail,
}: {
  email: string;
  secondsLeft: number;
  sending: boolean;
  sentAgain: boolean;
  onResend: () => void;
  onChangeEmail: () => void;
}) {
  const link =
    "inline-flex min-h-11 items-center font-semibold text-primary-text underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:text-muted-foreground disabled:no-underline";
  return (
    <div className="mt-4 space-y-2">
      {sentAgain && (
        <Notice tone="success">
          A new code is on its way to {email}. Use the newest one.
        </Notice>
      )}
      <div className="flex flex-wrap gap-x-6 text-sm">
        <button type="button" className={link} disabled={secondsLeft > 0 || sending} onClick={onResend}>
          {secondsLeft > 0 ? `Send a new code in ${secondsLeft}s` : sending ? "Sending…" : "Send a new code"}
        </button>
        <button type="button" className={link} onClick={onChangeEmail}>
          Wrong email? Change it
        </button>
      </div>
    </div>
  );
}
