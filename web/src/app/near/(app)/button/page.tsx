import type { Metadata } from "next";
import { ButtonSetup } from "@/components/near/button-setup";
import { PageHead } from "@/components/near/split-card";

export const metadata: Metadata = { title: "Checkout button" };

export default function NearButtonPage() {
  return (
    <div>
      <PageHead title="Checkout button">
        A &ldquo;Pay with Splits&rdquo; button for any shop or app. Set once who gets which part of every sale, paste the button, and each sale lands divided: supplier, tax and tips, each with its purpose.
      </PageHead>
      <ButtonSetup />
    </div>
  );
}
