"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { api, ApiError, errorMessage, type Me } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";

type MeState = { me: Me; refresh: () => Promise<void> };
const MeContext = React.createContext<MeState | null>(null);

export function useMe(): MeState {
  const value = React.useContext(MeContext);
  if (!value) throw new Error("useMe must be used inside AppFrame");
  return value;
}

/**
 * The signed-in shell. Loads the user once, sends signed-out visitors to sign in and anyone
 * without a PIN to set one, and shows a Preview tag whenever money is simulated.
 */
export function AppFrame({ children, requirePin = true }: { children: React.ReactNode; requirePin?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = React.useState<Me | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const data = await api<Me>("/api/me");
      setMe(data);
      setError(null);
      if (requirePin && !data.user.hasPin) router.replace("/setup");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/");
      else setError(errorMessage(err));
    }
  }, [requirePin, router]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-4 sm:px-6">
        <Link
          href="/home"
          className="inline-flex min-h-11 items-center rounded-lg display-face text-xl font-bold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Splits
        </Link>
        <div className="flex items-center gap-2">
          {me?.mode === "preview" && (
            <span
              className="rounded-full bg-purpose-1 px-3 py-1 text-xs font-bold text-primary"
              title="Money on this server is simulated"
            >
              Preview
            </span>
          )}
          {me && (
            <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline" title={me.user.email}>
              {me.user.email}
            </span>
          )}
          {me && pathname !== "/setup" && (
            <Button variant="ghost" onClick={signOut} className="px-3">
              Sign out
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-20 sm:px-6">
        {error && !me && (
          <div className="mx-auto mt-16 max-w-sm space-y-4">
            <Notice tone="error">{error}</Notice>
            <Button variant="secondary" onClick={() => void refresh()} className="w-full">
              Try again
            </Button>
          </div>
        )}
        {!me && !error && <FrameSkeleton />}
        {me && <MeContext.Provider value={{ me, refresh }}>{children}</MeContext.Provider>}
      </main>
    </div>
  );
}

function FrameSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="mt-4 space-y-6">
      <div className="h-44 rounded-[28px] bg-primary/15 motion-safe:animate-pulse" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1].map((i) => (
          <div key={i} className="h-72 rounded-[20px] bg-muted motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}
