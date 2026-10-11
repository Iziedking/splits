/**
 * One page of a list, with the page number clamped into range so a list that shrinks (or a stale
 * page number) never shows an empty page. An empty list is one empty page.
 */
export function pageOf<T>(items: readonly T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(Math.max(0, page), pages - 1);
  return { items: items.slice(at * size, at * size + size), page: at, pages };
}
