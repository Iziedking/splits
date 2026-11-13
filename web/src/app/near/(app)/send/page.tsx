import type { Metadata } from "next";
import { SAMPLE, SendFlow } from "@/components/near/send-flow";
import { PageHead } from "@/components/near/split-card";

export const metadata: Metadata = { title: "Pay people" };

type Props = { searchParams: Promise<{ sample?: string }> };

export default async function NearSendPage({ searchParams }: Props) {
  const { sample } = await searchParams;
  return (
    <div>
      <PageHead title="Pay people">One payment from your account, divided between several people, with a purpose on every part. You approve once.</PageHead>
      <SendFlow initial={sample === "1" ? SAMPLE : undefined} />
    </div>
  );
}
