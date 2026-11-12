import type { Metadata } from "next";
import { PageHead } from "@/components/near/split-card";
import { SplitFlow } from "@/components/near/split-flow";

export const metadata: Metadata = { title: "Auto-split my income" };

export default function NearSplitPage() {
  return (
    <div>
      <PageHead title="Auto-split my income">
        Into tax, savings and spending, or however you like. Save it once and every payment sent to you through Splits divides itself on NEAR when it arrives.
      </PageHead>
      <SplitFlow />
    </div>
  );
}
