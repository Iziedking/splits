import { Resend } from "resend";
import { brandedEmail } from "../email/layout";

/** What a recipient is told when money reaches them. */
export type PaymentNotice = { from: string; amount: string; purpose: string; appUrl: string };

/** One alert about someone's money (deposit ready, payment landed, …), with a link back in. */
export type AlertEmail = { subject: string; title: string; body: string; url: string | null; kind?: string; amount?: string | null };

/** The small label above an alert's title, by what happened. */
const ALERT_LABEL: Record<string, string> = {
  deposit_ready: "Deposit ready",
  deposit_waiting: "Deposit arrived",
  deposit_stuck: "Deposit update",
  payment_landed: "Payment landed",
  payment_failed: "Payment needs a look",
};

export interface EmailSender {
  sendLoginCode(email: string, code: string): Promise<void>;
  sendPaymentNotice(to: string, notice: PaymentNotice): Promise<void>;
  /** A visitor's own receipt: a link back to their payment. */
  sendReceiptLink(to: string, r: { amount: string; url: string }): Promise<void>;
  sendAlert(to: string, alert: AlertEmail): Promise<void>;
}

/** Preview mode keeps codes in memory so the sign-in screen can show them. Nothing is sent. */
export class PreviewEmail implements EmailSender {
  readonly sent = new Map<string, string>();
  readonly notices: { to: string; notice: PaymentNotice }[] = [];
  async sendLoginCode(email: string, code: string) {
    this.sent.set(email, code);
  }
  async sendPaymentNotice(to: string, notice: PaymentNotice) {
    this.notices.push({ to, notice });
  }
  readonly receipts: { to: string; amount: string; url: string }[] = [];
  async sendReceiptLink(to: string, r: { amount: string; url: string }) {
    this.receipts.push({ to, ...r });
  }
  readonly alerts: { to: string; alert: AlertEmail }[] = [];
  async sendAlert(to: string, alert: AlertEmail) {
    this.alerts.push({ to, alert });
  }
}

export function createResendEmail(apiKey: string, from: string, appUrl?: string): EmailSender {
  const resend = new Resend(apiKey);
  const send = async (to: string, subject: string, content: { html: string; text: string }) => {
    const { error } = await resend.emails.send({ from, to, subject, ...content });
    if (error) {
      const err = new Error(`Email provider refused the message: ${error.message}`);
      // A rate limit is the provider asking us to slow down, not a problem with this email.
      if (error.name === "rate_limit_exceeded") err.name = "RateLimited";
      throw err;
    }
  };
  return {
    async sendLoginCode(email, code) {
      await send(
        email,
        `Your Splits code is ${code}`,
        brandedEmail({
          appUrl,
          eyebrow: "Sign in",
          title: "Your sign-in code",
          code,
          preheader: `${code} is your Splits code. It expires in 10 minutes.`,
          body: ["Enter it on the Splits sign-in screen. It expires in 10 minutes.", "If you didn't ask for it, you can ignore this email."],
          footer: "Splits never asks for this code by phone, chat or email.",
        }),
      );
    },
    async sendPaymentNotice(to, n) {
      const e = paymentNoticeEmail(n);
      await send(to, e.subject, e);
    },
    async sendReceiptLink(to, r) {
      await send(
        to,
        `Your Splits receipt for $${r.amount}`,
        brandedEmail({
          appUrl,
          eyebrow: "Payment landed",
          title: "Your payment landed",
          amount: `$${r.amount}`,
          details: [["Network", "Arc · USDC"], ["Paid from", "Your own wallet"]],
          preheader: `Your $${r.amount} payment landed, divided. Each person has a receipt.`,
          body: ["Everyone was paid in one transaction on Arc. Open your receipt to see who got what, and share each person's own receipt."],
          button: { label: "View receipt", url: r.url },
          footer: "You're getting this because you asked for a receipt when you paid with Splits.",
        }),
      );
    },
    async sendAlert(to, a) {
      await send(
        to,
        a.subject,
        brandedEmail({
          appUrl,
          eyebrow: (a.kind && ALERT_LABEL[a.kind]) || "Splits",
          title: a.title,
          amount: a.amount ? `$${a.amount}` : undefined,
          preheader: a.body,
          body: [a.body],
          button: a.url ? { label: "Open Splits", url: a.url } : undefined,
          footer: "You're getting this because email alerts are on. Turn them off any time in Settings.",
        }),
      );
    },
  };
}

/** The "you received money" email. Signing in with the address it went to is the claim. */
export function paymentNoticeEmail(n: PaymentNotice): { subject: string; text: string; html: string } {
  const email = brandedEmail({
    appUrl: n.appUrl,
    eyebrow: "Money received",
    title: "You received money",
    amount: `$${n.amount}`,
    details: [
      ["From", n.from],
      ["For", n.purpose],
      ["Network", "Arc · USDC"],
    ],
    preheader: `${n.from} sent you $${n.amount} for "${n.purpose}".`,
    body: [`${n.from} sent you $${n.amount} USDC for "${n.purpose}".`, `Sign in with this email at ${n.appUrl} to use it. There's nothing to install and no password.`],
    button: { label: "Open Splits", url: n.appUrl },
    footer: "You're getting this because someone paid this email address through Splits.",
  });
  return { subject: `You received $${n.amount} on Splits`, ...email };
}
