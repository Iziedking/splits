"use client";

import * as React from "react";
import { AboutContent, AboutSignUp } from "@/components/app/about-content";
import { AppFrame } from "@/components/app/app-frame";
import { BackLink } from "@/components/app/back-link";
import { Backdrop } from "@/components/app/backdrop";
import { VisitorHeader } from "@/components/app/visitor-header";
import { api, type Me } from "@/lib/api";

/**
 * About inside the app for someone signed in (the rail's About: no sign-up buttons, the rail
 * stays), and as a public page with Back and Get started for everyone else. The public page is
 * what renders first, so it is also what search engines and link previews see.
 */
export function AboutShell() {
  const [signedIn, setSignedIn] = React.useState(false);
  React.useEffect(() => {
    api<Me>("/api/me")
      .then(() => setSignedIn(true))
      .catch(() => undefined);
  }, []);

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
