import type { Metadata } from "next";
import { ButtonSetup } from "@/components/near/button-setup";
import { PageHead } from "@/components/near/split-card";
import { ELSEWHERE_SHOP_URL } from "@/lib/near/button";

export const metadata: Metadata = { title: "Checkout button" };

export default function NearButtonPage() {
  return (
    <div>
      <PageHead title="Checkout button">
        A &ldquo;Pay with Splits&rdquo; button for any shop or app. Set once who gets which part of every sale, paste the button, and each sale lands divided: supplier, tax and tips, each with its purpose.
      </PageHead>
      <p className="-mt-4 mb-8 max-w-2xl text-muted-foreground">
        See it on a site that is not ours:{" "}
        <a className="font-medium text-primary-text underline underline-offset-4" href={ELSEWHERE_SHOP_URL} target="_blank" rel="noreferrer">
          Ada&rsquo;s Bakery
        </a>
        , a plain HTML page with the button pasted in.
      </p>
      <ButtonSetup />
    </div>
  );
}
