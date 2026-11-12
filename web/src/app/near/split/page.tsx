import type { Metadata } from "next";
import { SplitFlow } from "@/components/near/split-flow";

export const metadata: Metadata = { title: "Auto-split my income" };

export default function NearSplitPage() {
  return (
    <div>
      <h1 className="display-face text-3xl font-bold">Auto-split my income</h1>
      <p className="mt-2 mb-5 max-w-2xl text-muted-foreground">
        Into tax, savings and spending, or however you like. Save it once and every payment sent to you through Splits divides itself on NEAR when it arrives.
      </p>
      <SplitFlow />
    </div>
  );
}
