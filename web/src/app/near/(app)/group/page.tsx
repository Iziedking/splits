import type { Metadata } from "next";
import { Suspense } from "react";
import { GroupFlow } from "@/components/near/group-flow";
import { PageHead } from "@/components/near/split-card";

export const metadata: Metadata = { title: "Group fund" };

export default function NearGroupPage() {
  return (
    <div>
      <PageHead title="Group fund">
        Flatmates, a trip or a team vote once on how shared money divides. Every payment to the group then follows that rule.
      </PageHead>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <GroupFlow />
      </Suspense>
    </div>
  );
}
