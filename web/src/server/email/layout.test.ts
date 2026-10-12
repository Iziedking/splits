import { describe, expect, it } from "vitest";
import { brandedEmail } from "./layout";

describe("branded email", () => {
  it("has the Splits wordmark in teal, the title, the body, a button and a plain text part", () => {
    const e = brandedEmail({ title: "Your $49.99 is ready", body: ["It arrived from Base.", "You can split it now."], button: { label: "Open Splits", url: "https://mysplits.xyz/home" } });
    expect(e.html).toContain("#0FA39A");
    expect(e.html).toContain(">Splits<");
    expect(e.html).toContain("Your $49.99 is ready");
    expect(e.html).toContain('href="https://mysplits.xyz/home"');
    expect(e.text).toBe("Your $49.99 is ready\n\nIt arrived from Base.\n\nYou can split it now.\n\nOpen Splits: https://mysplits.xyz/home");
  });

  it("escapes anything a person typed", () => {
    const e = brandedEmail({ title: "<b>x</b>", body: ['for "rent" & <script>'] });
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("only links to http(s) urls", () => {
    expect(brandedEmail({ title: "t", body: [], button: { label: "x", url: "javascript:alert(1)" } }).html).not.toContain("javascript:");
  });
});
