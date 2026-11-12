import type { ReactNode } from "react";
import { AppShell } from "@/components/near/shell";

/** The app: overview, auto-split, pay a split and payroll. */
export default function NearAppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
