import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AboutContent } from "@/components/app/about-content";
import { Landing } from "./landing";

/** The words a reader sees, with tags gone and the entities React writes turned back into text. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&apos;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** Rail and chain vocabulary that must not reach a consumer outside About's technical section. */
const FORBIDDEN = [/mainnet/i, /USDC/, /on Arc\b/, /coming soon/i, /demo card/i, /simulated/i, /Built on Arc/];

describe("landing copy", () => {
  const page = text(renderToStaticMarkup(<Landing />));

  it("speaks money, not rails", () => {
    for (const pattern of FORBIDDEN) expect(page).not.toMatch(pattern);
  });

  it("keeps the lines that are right and names the retitled sections", () => {
    expect(page).toContain("Send once. It lands divided.");
    expect(page).toContain("Live now");
    expect(page).toContain("Why it's safe");
    expect(page).toContain("Technical details");
    expect(page).not.toContain("Live on Arc");
  });

  it("has none of the writing tells the audit fixed (report 4.2)", () => {
    const html = renderToStaticMarkup(<Landing />);
    for (const tell of [/no seed phrase/i, /not a promise/i, /single transaction/i, /—/, /[“”‘’]/, /→/, /seamless|empower|unlock/i]) {
      expect(page).not.toMatch(tell);
    }
    // The hero's long second sentence became two short ones.
    expect(page).toContain("Each part lands labelled. The people you pay only need an email.");
    expect(html).toContain("Pay without an account");
  });

  it("shows Pay without an account in the hero on every screen size", () => {
    const html = renderToStaticMarkup(<Landing />);
    const cta = html.match(/<a[^>]*href="\/send"[^>]*>(?:(?!<\/a>).)*Pay without an account/s)?.[0] ?? "";
    expect(cta).not.toBe("");
    expect(cta).not.toMatch(/max-sm:hidden|hidden sm:/);
  });

  it("does not claim a rail that is not switched on", () => {
    // Card, Apple Pay, Google Pay and bank transfer appear only in the roadmap, marked Planned.
    const roadmap = page.indexOf("These are next, not live yet.");
    expect(roadmap).toBeGreaterThan(0);
    for (const rail of ["Apple Pay", "Google Pay", "bank transfer", "Debit card"]) {
      expect(page.indexOf(rail)).toBeGreaterThan(roadmap);
    }
  });
});

describe("About copy", () => {
  const html = renderToStaticMarkup(<AboutContent />);
  const start = html.indexOf('aria-labelledby="safe-heading"');
  const end = html.indexOf("</section>", start);
  const technical = text(html.slice(start, end));
  const rest = text(html.slice(0, start) + html.slice(end));

  it("keeps the network and contract facts inside the safety section", () => {
    expect(start).toBeGreaterThan(0);
    expect(technical).toContain("Arc");
    expect(technical).toContain("Sourcify");
    expect(technical).toContain("$500");
    for (const pattern of [/mainnet/i, /USDC/, /on Arc\b/, /coming soon/i]) expect(rest).not.toMatch(pattern);
  });

  it("says plainly that card and bank are not live", () => {
    expect(rest).toContain("None of these is live yet.");
    expect(rest).not.toMatch(/coming soon|coming next/i);
  });
});
