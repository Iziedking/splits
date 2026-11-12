import type { ReactNode } from "react";
import { SiteShell } from "@/components/near/shell";

/** The public pages: landing, how it works, pay links and receipts. */
export default function NearSiteLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
