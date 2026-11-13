/**
 * Names this browser knows for NEAR accounts: the emails the person paid by. Kept on the device only,
 * so a receipt or a split can say "ada@example.com" instead of a long account address.
 */
const KEY = "splits:near:names";

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function rememberName(accountId: string, name: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [accountId]: name }));
  } catch {
    // Private windows may refuse; the address shows instead.
  }
}

export function knownName(accountId: string): string | null {
  return typeof window === "undefined" ? null : (read()[accountId] ?? null);
}

/** How a person sees an account: themselves, one of their pockets, someone they paid by email, or null. */
export function friendlyName(accountId: string, me: string | null): string | null {
  if (me) {
    if (accountId === me) return "You";
    if (accountId === `tax.${me}`) return "Your tax pocket";
    if (accountId === `savings.${me}`) return "Your savings pocket";
  }
  return knownName(accountId);
}
