import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every .tsx file under app/ and components/. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

/** The source of the JSX tag starting at `at`: up to "/>" or a ">" on its own line, else its line. */
function tagAt(text: string, at: number): string {
  const rest = text.slice(at);
  const end = rest.search(/\/>|\n\s*>/);
  const firstLine = rest.split("\n")[0]!;
  return end < 0 || !rest.slice(0, end).includes("\n") ? firstLine : rest.slice(0, end);
}

// iOS Safari zooms the page in when a field with text under 16px gets focus, and leaves it zoomed.
// Fields may be smaller only from the lg breakpoint (desktop), never on phones or tablets.
const SMALL = /^text-(xs|sm|\[(1[0-5]|[0-9])px\])$/;

describe("text fields on phones", () => {
  it("are at least 16px, so iOS never zooms in when one is tapped", () => {
    const root = join(__dirname, "..");
    const offenders: string[] = [];
    for (const file of [...sources(join(root, "app")), ...sources(join(root, "components"))]) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/<(input|textarea|select)\b/g)) {
        const tag = tagAt(text, m.index);
        if (/type="(checkbox|radio|range|file)"/.test(tag)) continue;
        const classes = [...tag.matchAll(/"([^"]*)"/g)].flatMap((c) => c[1]!.split(/\s+/));
        if (classes.some((c) => SMALL.test(c))) offenders.push(`${file.slice(root.length)}:${text.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
