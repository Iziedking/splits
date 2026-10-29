"use client";

import { AppFrame } from "@/components/app/app-frame";
import { BackLink } from "@/components/app/back-link";
import { Backdrop } from "@/components/app/backdrop";
import { VisitorHeader } from "@/components/app/visitor-header";

/**
 * Help, Terms and Privacy: inside the app for someone signed in (the rail stays), and as a public
 * page with Back for everyone else, the way About works. `signedIn` comes from the server.
 */
export function InfoShell({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
  if (signedIn) {
    return (
      <AppFrame>
        <div className="pt-4">{children}</div>
      </AppFrame>
    );
  }
  return (
    <>
      <Backdrop />
      <VisitorHeader />
      <main className="mx-auto max-w-md px-5 pt-4 pb-[max(3rem,env(safe-area-inset-bottom))]">
        <BackLink />
        <div className="mt-2">{children}</div>
      </main>
    </>
  );
}
