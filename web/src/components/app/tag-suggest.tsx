"use client";

import * as React from "react";
import { api } from "@/lib/api";

/** Where a tag is being typed: the line around the caret, up to its first comma or tab. */
function lineAt(value: string, caret: number) {
  const start = value.lastIndexOf("\n", caret - 1) + 1;
  const endOfLine = value.indexOf("\n", caret);
  const end = endOfLine === -1 ? value.length : endOfLine;
  const line = value.slice(start, end);
  const cut = line.search(/[,\t]/);
  return { start, who: cut === -1 ? line : line.slice(0, cut), rest: cut === -1 ? "" : line.slice(cut), end };
}

/** The part of a tag typed so far at the caret, once it's long enough to search (2+ characters after @). */
export function tagQueryAt(value: string, caret: number): string | null {
  const { start, who } = lineAt(value, caret);
  if (caret > start + who.length) return null;
  const m = /^\s*[@＠]([A-Za-z0-9_]{2,20})$/.exec(who.trimEnd());
  return m ? m[1]!.toLowerCase() : null;
}

/** The value with the tag at the caret replaced by the one picked; whatever followed on the line stays. */
export function applyTag(value: string, caret: number, tag: string): string {
  const { start, rest, end } = lineAt(value, caret);
  return `${value.slice(0, start)}@${tag}${rest}${value.slice(end)}`;
}

/**
 * Up to 5 tags starting with what's typed, as buttons under the field (Tab reaches them; Enter or a
 * tap picks one). Only for signed-in payers: the search needs a session, and never shows emails.
 */
export function TagSuggest({ value, caret, onPick }: { value: string; caret: number; onPick: (next: string) => void }) {
  const query = tagQueryAt(value, caret);
  const [tags, setTags] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!query) return setTags([]);
    let live = true;
    const timer = setTimeout(() => {
      api<{ tags: string[] }>(`/api/tags/search?q=${encodeURIComponent(query)}`)
        .then((r) => live && setTags(r.tags.slice(0, 5)))
        .catch(() => live && setTags([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  return <TagOptions tags={query ? tags : []} onPick={(tag) => onPick(applyTag(value, caret, tag))} />;
}

export function TagOptions({ tags, onPick }: { tags: string[]; onPick: (tag: string) => void }) {
  if (!tags.length) return null;
  return (
    <ul aria-label="Matching Split tags" className="mt-1 flex flex-wrap gap-2">
      {tags.slice(0, 5).map((tag) => (
        <li key={tag}>
          <button
            type="button"
            onClick={() => onPick(tag)}
            className="min-h-11 rounded-full bg-white/70 px-4 text-sm font-semibold ring-1 ring-border hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            @{tag}
          </button>
        </li>
      ))}
    </ul>
  );
}
