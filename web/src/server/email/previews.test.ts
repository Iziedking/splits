import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * The four emails as the provider would receive them, built by the real templates (fintech face
 * WP6). Every run checks their wording; with EMAIL_PREVIEWS_OUT set it also writes the HTML, which
 * is how docs/email-previews is regenerated (never edited by hand).
 */

const sent = vi.hoisted(() => [] as { subject: string; html: string; text: string }[]);
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (m: { subject: string; html: string; text: string }) => {
        sent.push(m);
        return { error: null };
      },
    };
  },
}));

const { createResendEmail } = await import("../auth/email");

const APP = "https://mysplits.xyz";
const FORBIDDEN = /USDC|\bArc\b|\bEVM\b|explorer|transaction|\bBase\b/;

async function render() {
  sent.length = 0;
  const email = createResendEmail("re_test", "Splits <hello@mysplits.xyz>", APP);
  await email.sendLoginCode("ada@example.com", "482913");
  await email.sendPaymentNotice("mum@example.com", { from: "Ada", amount: "320.00", purpose: "rent", appUrl: APP });
  await email.sendReceiptLink("payer@example.com", { amount: "60.90", url: `${APP}/p/example` });
  await email.sendAlert("ada@example.com", {
    subject: "$19.99 is in your balance",
    title: "$19.99 is in your balance",
    body: "It arrived and is ready to send.",
    url: `${APP}/home`,
    kind: "deposit_ready",
    amount: "19.99",
  });
  return sent.slice();
}

describe("the emails", () => {
  it("speak money, not rails", async () => {
    for (const m of await render()) {
      expect(`${m.subject}\n${m.text}`, m.subject).not.toMatch(FORBIDDEN);
    }
  });

  it("say what was received in plain words", async () => {
    const [, received] = await render();
    expect(received!.text).toContain("Ada sent you $320.00 for rent.");
    expect(received!.text).not.toContain("Network");
  });

  it("write the previews when asked", async () => {
    const out = process.env.EMAIL_PREVIEWS_OUT;
    if (!out) return;
    mkdirSync(out, { recursive: true });
    const names = ["1-sign-in.html", "2-received.html", "3-receipt.html", "4-deposit.html"];
    (await render()).forEach((m, i) => writeFileSync(join(out, names[i]!), m.html));
  });
});
