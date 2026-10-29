import { describe, expect, it } from "vitest";
import { paymentNoticeEmail } from "./email";

describe("the payment notice email", () => {
  it("says who paid, how much in dollars, what for, and how to claim it", () => {
    const { subject, text, html } = paymentNoticeEmail({
      from: "host@example.com",
      amount: "5.00",
      purpose: "giveaway prize",
      appUrl: "https://splits.example",
    });
    expect(subject).toBe("You received $5.00 on Splits");
    expect(text).toContain("host@example.com sent you $5.00 for giveaway prize.");
    expect(text).not.toMatch(/USDC|\bArc\b/);
    expect(text).toContain("Sign in with this email at https://splits.example to use it.");
    expect(html).toContain('href="https://splits.example/signin"');
  });
});
