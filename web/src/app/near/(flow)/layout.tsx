import type { ReactNode } from "react";
import { FlowShell } from "@/components/near/shell";

/** One task, start to finish: a pay link, paying from another chain, a receipt. */
export default function NearFlowLayout({ children }: { children: ReactNode }) {
  return <FlowShell>{children}</FlowShell>;
}
