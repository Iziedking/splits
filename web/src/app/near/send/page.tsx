import type { Metadata } from "next";
import { SAMPLE, SendFlow } from "@/components/near/send-flow";

export const metadata: Metadata = { title: "Pay a split" };

type Props = { searchParams: Promise<{ sample?: string }> };

export default async function NearSendPage({ searchParams }: Props) {
  const { sample } = await searchParams;
  return (
    <div>
      <h1 className="display-face mb-5 text-3xl font-bold">Pay a split</h1>
      <SendFlow initial={sample === "1" ? SAMPLE : undefined} />
    </div>
  );
}
