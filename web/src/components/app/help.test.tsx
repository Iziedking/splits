import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Landing } from "@/components/landing/landing";
import { helpHref, reference, supportMailto } from "@/lib/support";
import { HelpLink } from "./help-link";
import { LegalPage } from "./legal-page";

/** Legal, help and trust (fintech face WP7). */

describe("payment references", () => {
  it("are short, upper case and the same for the same payment", () => {
    expect(reference("8f3c12aa-0b1c-4d2e-9f00-123456789abc")).toBe("8F3C12AA0B1C");
    expect(helpHref("8f3c12aa-0b1c-4d2e-9f00-123456789abc")).toBe("/help?ref=8F3C12AA0B1C");
    expect(helpHref(null)).toBe("/help");
  });

  it("go into the support email's subject and first line", () => {
    const href = supportMailto("help@example.com", "8F3C12AA0B1C");
    expect(href.startsWith("mailto:help@example.com?")).toBe(true);
    expect(decodeURIComponent(href)).toContain("subject=Help with payment 8F3C12AA0B1C");
    expect(decodeURIComponent(href)).toContain("Payment reference: 8F3C12AA0B1C");
  });

  it("are reached from every payment page by one link", () => {
    expect(renderToStaticMarkup(<HelpLink paymentId="8f3c12aa-0b1c" />)).toContain('href="/help?ref=8F3C12AA0B1C"');
  });
});

describe("legal pages", () => {
  it("say plainly that the document is coming, and link Help, Terms and Privacy", () => {
    const out = renderToStaticMarkup(<LegalPage title="Terms of use" pending="The terms of use for Splits are being written and will be published on this page." />);
    expect(out).toContain("are being written");
    for (const href of ["/help", "/legal/terms", "/legal/privacy"]) expect(out).toContain(`href="${href}"`);
    expect(out).toContain("Splits is not a bank");
  });

  it("are linked from the landing footer", () => {
    const out = renderToStaticMarkup(<Landing />);
    for (const href of ["/help", "/legal/terms", "/legal/privacy"]) expect(out).toContain(`href="${href}"`);
  });
});
