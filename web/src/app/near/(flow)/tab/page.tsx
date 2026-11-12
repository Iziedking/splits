import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TabFlow } from "@/components/near/tab-flow";
import { decodeBill } from "@/lib/near/bill";

export const metadata: Metadata = { title: "Pay your part", robots: { index: false } };

type Props = { searchParams: Promise<{ b?: string }> };

/** A shared bill. The bill rides in the link (lib/near/bill.ts); who has paid comes from the router. */
export default async function NearTabPage({ searchParams }: Props) {
  const { b } = await searchParams;
  const bill = b ? decodeBill(b) : null;
  if (!bill) notFound();
  return <TabFlow bill={bill} />;
}
