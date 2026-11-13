import type { Metadata } from "next";
import { ProfileFlow } from "@/components/near/profile-flow";
import { PageHead } from "@/components/near/split-card";

export const metadata: Metadata = { title: "Your profile" };

export default function NearProfilePage() {
  return (
    <div>
      <PageHead title="Your profile">Your picture, your account and signing out.</PageHead>
      <ProfileFlow />
    </div>
  );
}
