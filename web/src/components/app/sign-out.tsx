"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { createPortal } from "react-dom";
import { Loader } from "@/components/app/loader";
import { api } from "@/lib/api";

/** Long enough to read, short enough not to wait: the screen never just flashes away. */
const AT_LEAST_MS = 700;

/**
 * Sign out with a moment of feedback: a full-screen "Signing you out" with the Splits loader while
 * the session ends, then the sign-in page. Used by the desktop rail and by Profile.
 */
export function useSignOut() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const signOut = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    await Promise.all([api("/api/auth/logout", { method: "POST" }).catch(() => undefined), new Promise((r) => setTimeout(r, AT_LEAST_MS))]);
    router.replace("/");
  }, [busy, router]);

  const overlay = busy
    ? createPortal(
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
          <Loader label="Signing you out" className="min-h-0" />
          <p aria-hidden="true" className="mt-4 text-sm font-semibold text-muted-foreground">
            Signing you out…
          </p>
        </div>,
        document.body,
      )
    : null;

  return { signOut, signingOut: busy, overlay };
}
