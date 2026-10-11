import { Resend } from "resend";

/** What a recipient is told when money reaches them. */
export type PaymentNotice = { from: string; amount: string; purpose: string; appUrl: string };

export interface EmailSender {
  sendLoginCode(email: string, code: string): Promise<void>;
  sendPaymentNotice(to: string, notice: PaymentNotice): Promise<void>;
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
}

export function createResendEmail(apiKey: string, from: string): EmailSender {
  const resend = new Resend(apiKey);
  return {
    async sendLoginCode(email, code) {
      const { error } = await resend.emails.send({
        from,
        to: email,
        subject: `Your Splits code is ${code}`,
        text: `Your Splits sign-in code is ${code}. It expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
      });
      if (error) throw new Error(`Email provider refused the message: ${error.message}`);
    },
    async sendPaymentNotice(to, n) {
      const { error } = await resend.emails.send({ from, to, ...paymentNoticeEmail(n) });
      if (error) {
        const err = new Error(`Email provider refused the message: ${error.message}`);
        // A rate limit is the provider asking us to slow down, not a problem with this notice.
        if (error.name === "rate_limit_exceeded") err.name = "RateLimited";
        throw err;
      }
    },
  };
}

/** The "you received money" email. Signing in with the address it went to is the claim. */
export function paymentNoticeEmail(n: PaymentNotice): { subject: string; text: string } {
  return {
    subject: `You received $${n.amount} on Splits`,
    text:
      `${n.from} sent you $${n.amount} USDC for "${n.purpose}".\n\n` +
      `Sign in with this email at ${n.appUrl} to use it. There's nothing to install and no password.`,
  };
}
