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

  it("shows the Splits logo from the app's own address, and never from anywhere unsafe", () => {
    const e = brandedEmail({ title: "Hi", body: ["x"], appUrl: "https://mysplits.xyz" });
    expect(e.html).toContain('<img src="https://mysplits.xyz/brand/logo-email.png" alt="Splits"');
    expect(brandedEmail({ title: "Hi", body: ["x"], appUrl: "javascript:alert(1)" }).html).not.toContain("<img");
    expect(brandedEmail({ title: "Hi", body: ["x"] }).html).toContain(">Splits<");
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

  it("shows the amount large, a details table, a sign-in code and an inbox preview line, all escaped", () => {
    const e = brandedEmail({
      appUrl: "https://mysplits.xyz",
      eyebrow: "Money received",
      title: "You received money",
      amount: "$20.00",
      details: [["From", "<b>Ada</b>"], ["For", 'rent & "bills"']],
      code: "482913",
      preheader: "Ada sent you $20.00",
      body: ["Sign in to use it."],
      button: { label: "Open Splits", url: "https://mysplits.xyz/home" },
    });
    expect(e.html).toContain(">Money received<");
    expect(e.html).toContain(">$20.00<");
    expect(e.html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(e.html).toContain("rent &amp; &quot;bills&quot;");
    expect(e.html).not.toContain("<b>Ada</b>");
    expect(e.html).toContain(">482913<");
    expect(e.html).toContain("display:none");
    expect(e.html).toContain('href="https://mysplits.xyz/about"');
    expect(e.text).toBe(
      'You received money\n\n$20.00\n\n482913\n\nFrom: <b>Ada</b>\nFor: rent & "bills"\n\nSign in to use it.\n\nOpen Splits: https://mysplits.xyz/home',
    );
  });
});
