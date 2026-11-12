import type { Metadata } from "next";
import { BillSetup } from "@/components/near/bill-setup";
import { PageHead } from "@/components/near/split-card";

export const metadata: Metadata = { title: "Split a bill" };

export default function NearBillPage() {
  return (
    <div>
      <PageHead title="Split a bill">
        You paid for dinner. Put in the bill and who was there, share one link in the group chat, and each friend pays their part straight to you. You see who has paid as it happens.
      </PageHead>
      <BillSetup />
    </div>
  );
}
