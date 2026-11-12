import type { Metadata } from "next";
import { Overview } from "@/components/near/overview";

export const metadata: Metadata = { title: "Home" };

export default function NearAppOverviewPage() {
  return <Overview />;
}
