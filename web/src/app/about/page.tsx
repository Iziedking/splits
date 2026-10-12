import { AboutShell } from "@/components/app/about-shell";

export const metadata = {
  title: "About Splits",
  description: "Send money home in one payment and it arrives divided between the people it is for, each part with its purpose.",
};

/**
 * What Splits is and the problem it solves, readable without signing in (linked quietly from the
 * welcome screen, from Profile, and from the desktop rail). Content: components/app/about-content.tsx.
 */
export default function AboutPage() {
  return <AboutShell />;
}
