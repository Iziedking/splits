/**
 * One flat colour per part of a split, in order, so a purpose keeps its colour on every screen.
 * Values mirror the --purpose-N tokens in globals.css (SVG needs them as plain values).
 */
export const PURPOSE_FILLS = ["#f4b400", "#12a26b", "#e2367f", "#2f7cf6", "#9a7cf6", "#a9c934"] as const;

/** Text colour that reads on each fill (indigo on light fills, white on dark ones). */
const TEXT_ON = ["#1f1b4d", "#1f1b4d", "#ffffff", "#ffffff", "#1f1b4d", "#1f1b4d"] as const;

export const INDIGO = "#1f1b4d";

export function purposeFill(index: number): string {
  return PURPOSE_FILLS[index % PURPOSE_FILLS.length]!;
}

export function textOnPurpose(index: number): string {
  return TEXT_ON[index % TEXT_ON.length]!;
}
