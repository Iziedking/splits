import { Resend } from "resend";

export interface EmailSender {
  sendLoginCode(email: string, code: string): Promise<void>;
}

/** Preview mode keeps codes in memory so the sign-in screen can show them. Nothing is sent. */
export class PreviewEmail implements EmailSender {
  readonly sent = new Map<string, string>();
  async sendLoginCode(email: string, code: string) {
    this.sent.set(email, code);
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
  };
}
