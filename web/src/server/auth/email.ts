import { Resend } from "resend";
import { brandedEmail } from "../email/layout";
import type { Handover } from "../support/handover";

/** What a recipient is told when money reaches them. */
export type PaymentNotice = { from: string; amount: string; purpose: string; appUrl: string };

/** One alert about someone's money (deposit ready, payment landed, …), with a link back in. */
export type AlertEmail = { subject: string; title: string; body: string; url: string | null; kind?: string; amount?: string | null };

/** The small label above an alert's title, by what happened. */
const ALERT_LABEL: Record<string, string> = {
  deposit_ready: "Money added",
  deposit_waiting: "Money arrived",
  deposit_stuck: "Money update",
  payment_landed: "Payment landed",
  payment_failed: "Payment needs a look",
};

export interface EmailSender {
  sendLoginCode(email: string, code: string): Promise<void>;
  sendPaymentNotice(to: string, notice: PaymentNotice): Promise<void>;
  /** A visitor's own receipt: a link back to their payment. */
  sendReceiptLink(to: string, r: { amount: string; url: string }): Promise<void>;
  sendAlert(to: string, alert: AlertEmail): Promise<void>;
  /** A support chat passed to the team; replying writes to the person. */
  sendSupportHandover(to: string, replyTo: string, h: Handover): Promise<void>;
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
  readonly handovers: { to: string; replyTo: string; h: Handover }[] = [];
  async sendSupportHandover(to: string, replyTo: string, h: Handover) {
    this.handovers.push({ to, replyTo, h });
  }
}

export function createResendEmail(apiKey: string, from: string, appUrl?: string): EmailSender {
  const resend = new Resend(apiKey);
  const send = async (to: string, subject: string, content: { html: string; text: string }, replyTo?: string) => {
    const { error } = await resend.emails.send({ from, to, subject, ...content, ...(replyTo ? { replyTo } : {}) });
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
          details: [["Paid from", "Your own wallet"]],
          preheader: `Your $${r.amount} payment landed, divided. Each person has a receipt.`,
          body: ["Everyone was paid at once. Open your receipt to see who got what, and share each person's own receipt."],
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
    async sendSupportHandover(to, replyTo, h) {
      const e = supportHandoverEmail(h, appUrl);
      await send(to, e.subject, e, replyTo);
    },
  };
}

const SPEAKER = { person: "Person", agent: "Agent", action: "Agent did" } as const;

/** What the team gets when the support agent hands a chat over: the summary first, then everything behind it. */
export function supportHandoverEmail(h: Handover, appUrl?: string): { subject: string; text: string; html: string } {
  const email = brandedEmail({
    appUrl,
    eyebrow: "Support hand-over",
    title: h.ref ? `Help with payment ${h.ref}` : "Help with Splits",
    details: [
      ["From", h.userEmail],
      ["Reference", h.ref ?? "None given"],
    ],
    preheader: h.summary,
    body: [
      `Summary: ${h.summary}`,
      h.payment ? `Payment: ${h.payment}` : "No payment was named in the chat.",
      "The chat:",
      ...h.transcript.map((m) => `${m.at.slice(0, 16).replace("T", " ")} UTC, ${SPEAKER[m.role]}: ${m.text}`),
    ],
    footer: `Reply to this email to answer ${h.userEmail} directly. They were told to expect a reply within 24 hours.`,
  });
  return { subject: h.ref ? `Help with payment ${h.ref}` : "Help with Splits", ...email };
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
    ],
    preheader: `${n.from} sent you $${n.amount} for "${n.purpose}".`,
    body: [`${n.from} sent you $${n.amount} for ${n.purpose}.`, `Sign in with this email at ${n.appUrl} to use it. There's nothing to install and no password.`],
    button: { label: "Open Splits", url: `${n.appUrl}/signin` },
    footer: "You're getting this because someone paid this email address through Splits.",
  });
  return { subject: `You received $${n.amount} on Splits`, ...email };
}
