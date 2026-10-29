/**
 * Split tags (@adakitchen): what an account shares instead of its email to get paid. Pure rules,
 * no database: the shape a tag takes, the words nobody can have, and a first suggestion.
 */
export const TAG = /^[a-z0-9_]{3,20}$/;

export const RESERVED_TAGS: ReadonlySet<string> = new Set([
  "splits", "mysplits", "support", "help", "admin", "team", "official", "security", "system", "root",
  "pay", "payments", "money", "wallet", "circle", "arc", "usdc", "null", "undefined", "me",
]);

/** Changes an account gets in its lifetime. */
export const TAG_CHANGES = 3;

export type TagProblem = "format" | "reserved";

/** What people type, as stored: no spaces, no leading @ (or the full-width ＠ social apps paste), lowercase. */
export function normaliseTag(input: string): string {
  return input.trim().replace(/^[@＠]/, "").toLowerCase();
}

/** Why a normalised tag can't be had, or null. */
export function tagProblem(tag: string): TagProblem | null {
  if (!TAG.test(tag)) return "format";
  if (RESERVED_TAGS.has(tag)) return "reserved";
  return null;
}

export const showTag = (tag: string) => `@${tag}`;

/** A starting point from the email's first part, always a valid, unreserved shape. Free-ness is checked separately. */
export function suggestTag(email: string): string {
  let tag = (email.split("@")[0] ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20)
    .replace(/_+$/, "");
  if (tag.length < 3) tag = `${tag}_pay`.replace(/^_/, "");
  if (RESERVED_TAGS.has(tag)) tag = `${tag}_1`;
  return tag;
}

/** A tag from a URL path; a malformed escape is read as typed rather than failing the page. */
export function tagFromPath(raw: string): string {
  try {
    return normaliseTag(decodeURIComponent(raw));
  } catch {
    return normaliseTag(raw);
  }
}
