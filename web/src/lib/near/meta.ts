import type { Metadata } from "next";

/**
 * What near.mysplits.xyz says about itself to browsers, crawlers and link previews (X, WhatsApp,
 * Slack). The NEAR host shares a server with the Arc app, so the root layout picks these by host.
 */
export const NEAR_SITE = process.env.NEAR_PUBLIC_URL || "https://near.mysplits.xyz";

const title = "Splits on NEAR: one payment, divided three ways";
const description =
  "A payment arrives on NEAR and divides itself into tax, savings and spending, each part with its purpose and proof. Sign in with an email: no wallet, no fees.";
const image = {
  url: "/og/near.png",
  width: 1200,
  height: 630,
  alt: "Splits on NEAR: a $100.00 payment divided into tax $30.00, savings $20.00 and spending $50.00.",
};

export function nearMetadata(): Metadata {
  return {
    metadataBase: new URL(NEAR_SITE),
    title: { default: "Splits on NEAR", template: "%s · Splits on NEAR" },
    description,
    applicationName: "Splits on NEAR",
    openGraph: { type: "website", siteName: "Splits on NEAR", title, description, url: "/", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
