/** One recipient handed to a pay screen in its URL, from a tag's page: ?to=@ada&amount=5&for=rent. */
export type Prefill = { to: string; amount: string; label: string | null };

/** Only a well-formed tag, a plain amount and a short reason are taken; anything else is dropped. */
export function readPrefill(search: string): Prefill | null {
  const params = new URLSearchParams(search);
  const to = (params.get("to") ?? "").trim().toLowerCase();
  if (!/^@[a-z0-9_]{3,20}$/.test(to)) return null;
  const amount = (params.get("amount") ?? "").trim();
  const label = (params.get("for") ?? "").trim().slice(0, 31);
  return { to, amount: /^\d{1,7}(\.\d{1,2})?$/.test(amount) ? amount : "", label: label || null };
}

/** Where a tag page's Pay button goes: the pay screen for account holders, paying from your own wallet for everyone else. */
export function tagPayHref(tag: string, signedIn: boolean, amount: string, label: string): string {
  const params = new URLSearchParams({ to: `@${tag}` });
  if (amount.trim()) params.set("amount", amount.trim());
  if (label.trim()) params.set("for", label.trim());
  return `${signedIn ? "/pay" : "/send"}?${params.toString()}`;
}
