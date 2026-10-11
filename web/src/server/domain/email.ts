import { z } from "zod";

/** The one definition of a usable email: sign-in and payout lists both use it, so nobody can be
 * paid at an address they would be unable to sign in with. */
export const emailSchema = z.email().max(254);

export function isValidEmail(email: string): boolean {
  return emailSchema.safeParse(email).success;
}
