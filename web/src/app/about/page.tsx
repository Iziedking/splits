import { AboutShell } from "@/components/app/about-shell";
import { userForSession } from "@/server/auth/sessions";
import { getCtx } from "@/server/context";
import { sessionToken } from "@/server/http";

export const metadata = {
  title: "About",
  description: "Send money home in one payment and it arrives divided between the people it is for, each part with its purpose.",
};

/**
 * What Splits is and the problem it solves, readable without signing in (linked quietly from the
 * welcome screen, from Profile, and from the desktop rail). The session is checked here, on the
 * server, so the page arrives in the right layout instead of switching after it has drawn.
 * Content: components/app/about-content.tsx.
 */
export default async function AboutPage() {
  const ctx = await getCtx();
  const user = await userForSession(ctx.db, await sessionToken(), ctx.now()).catch(() => null);
  return <AboutShell signedIn={Boolean(user)} />;
}
