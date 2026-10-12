"use client";

import { AboutContent, AboutSignUp } from "@/components/app/about-content";
import { AppFrame } from "@/components/app/app-frame";
import { BackLink } from "@/components/app/back-link";
import { Backdrop } from "@/components/app/backdrop";
import { VisitorHeader } from "@/components/app/visitor-header";

/**
 * About inside the app for someone signed in (the rail's About: no sign-up buttons, the rail
 * stays), and as a public page with Back and Get started for everyone else. `signedIn` comes from
 * the server, so the first paint is already the right one.
 */
export function AboutShell({ signedIn }: { signedIn: boolean }) {
  if (signedIn) {
    return (
      <AppFrame wide>
        <div className="pt-4 lg:max-w-5xl">
          <AboutContent />
        </div>
      </AppFrame>
    );
  }
  return (
    <>
      <Backdrop />
      <VisitorHeader wide />
      <main className="mx-auto max-w-md px-5 pt-4 pb-[max(3rem,env(safe-area-inset-bottom))] lg:max-w-5xl lg:px-10 lg:pb-16">
        <AboutContent top={<BackLink />} cta={<AboutSignUp />} />
      </main>
    </>
  );
}
