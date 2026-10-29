/** Which way someone came in: "Get started" or "I already have an account". */
export type SignInMode = "start" | "signin";

export const NEW_HERE = "Welcome to Splits. Let's set up your account.";
export const ALREADY_HAVE = "You already have an account. Welcome back.";

/**
 * Where a correct code leads. Whether the email has an account is only known after the code (so
 * the email screen never reveals it); a mismatch with the button they chose gets one line saying so.
 */
export function afterCode(mode: SignInMode, who: { isNew: boolean; hasPin: boolean; needsTag: boolean }): { notice: string | null; to: "/setup" | "/home" } {
  const to = !who.hasPin || who.needsTag ? "/setup" : "/home";
  if (mode === "start" && !who.isNew) return { notice: ALREADY_HAVE, to };
  if (mode === "signin" && who.isNew) return { notice: NEW_HERE, to };
  return { notice: null, to };
}
