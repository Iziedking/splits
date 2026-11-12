import type { Metadata } from "next";
import { PayrollFlow } from "@/components/near/payroll-flow";
import { PageHead } from "@/components/near/split-card";

export const metadata: Metadata = { title: "Payroll" };

export default function NearPayrollPage() {
  return (
    <div>
      <PageHead title="Payroll">
        Upload who gets paid, how much and what for. Check the list, approve once, then download a CSV of what landed for your accountant.
      </PageHead>
      <PayrollFlow />
    </div>
  );
}
