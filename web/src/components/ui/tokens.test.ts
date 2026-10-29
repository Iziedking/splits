import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The design tokens hold (fintech face WP2): colours, type sizes, radii and shadows come from
 * globals.css, and every text pairing the tokens define reads at WCAG AA (4.5:1).
 */

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const CSS = readFileSync(join(SRC, "app/globals.css"), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** UI code: pages, components and client helpers. lib/palette.ts is where literals for SVG and libraries live. */
const UI = ["app", "components", "lib"].flatMap((d) => files(join(SRC, d))).filter((f) => !f.endsWith(join("lib", "palette.ts")));

function offenders(pattern: RegExp): string[] {
  return UI.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, i) => (pattern.test(line) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])),
  );
}

describe("tokens only", () => {
  it("has no hex colour outside globals.css and lib/palette.ts", () => {
    expect(offenders(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/)).toEqual([]);
  });

  it("has no arbitrary font size", () => {
    expect(offenders(/\btext-\[\d+(\.\d+)?(px|rem)\]/)).toEqual([]);
  });

  it("has no arbitrary radius", () => {
    expect(offenders(/\brounded(-[a-z]+)?-\[\d+px\]/)).toEqual([]);
  });

  it("has no arbitrary or default Tailwind shadow", () => {
    expect(offenders(/\bshadow-\[|\bshadow-(sm|md|lg|xl|2xl)\b|(["'\s])shadow(["'\s])/)).toEqual([]);
  });

  it("has no inert dark theme", () => {
    expect(CSS).not.toMatch(/^\.dark\s*\{/m);
  });
});

/** The value of a custom property in :root, as #rrggbb. */
function token(name: string): string {
  const m = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`--${name} is not a hex token in globals.css`);
  return m[1]!.toLowerCase();
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
/** a over b at opacity t. */
function over(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v * t + y[i]! * (1 - t)).toString(16).padStart(2, "0")).join("")}`;
}

describe("contrast", () => {
  const white = "#ffffff";
  const bg = token("background");
  // The palest glass a card sits on: the `surface` white (66%) over each haze blob (70%) on mist.
  const glass = ["haze-teal", "haze-lilac", "haze-peach"].map((h) => over(white, over(token(h), bg, 0.7), 0.66));
  const grounds: Record<string, string> = {
    white,
    background: bg,
    accent: token("accent"),
    muted: token("muted"),
    secondary: token("secondary"),
    "primary/10": over(token("primary"), white, 0.1),
    ...Object.fromEntries(glass.map((g, i) => [`glass ${i + 1}`, g])),
  };

  for (const text of ["foreground", "muted-foreground", "primary-text", "success-text", "destructive"]) {
    it(`${text} reads at 4.5:1 on every light ground`, () => {
      const low = Object.entries(grounds).filter(([, g]) => contrast(token(text), g) < 4.5);
      expect(low.map(([name, g]) => `${name} ${contrast(token(text), g).toFixed(2)}`)).toEqual([]);
    });
  }

  it("white reads at 4.5:1 on the pill fill, its hover and the destructive fill", () => {
    for (const fill of ["primary-fill", "primary-fill-hover", "destructive"]) {
      expect(contrast(white, token(fill)), fill).toBeGreaterThanOrEqual(4.5);
    }
    expect(token("primary-foreground")).toBe(white);
  });

  it("keeps the brand teal for graphics at 3:1 on white", () => {
    expect(contrast(token("primary"), white)).toBeGreaterThanOrEqual(3);
  });
});
