/**
 * Where people get help (fintech face WP7). The support address is the owner's to choose, so it is
 * a setting: NEXT_PUBLIC_SUPPORT_EMAIL. Until it is set, Help says plainly that it is coming.
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || null;

/** A payment's id, as people quote it: short enough to read out, enough to find the payment. */
export const reference = (id: string) => id.replace(/-/g, "").slice(0, 12).toUpperCase();

/** The Help page, with a payment's reference filled in when there is one. */
export const helpHref = (paymentId?: string | null) => (paymentId ? `/help?ref=${encodeURIComponent(reference(paymentId))}` : "/help");

/** An email to support with the reference in the subject and the first line, ready to send. */
export function supportMailto(email: string, ref: string | null) {
  const subject = ref ? `Help with payment ${ref}` : "Help with Splits";
  const body = ref ? `Payment reference: ${ref}\n\nWhat happened:\n` : "What happened:\n";
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
