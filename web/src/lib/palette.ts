/**
 * One flat colour per part of a split, in order, so a purpose keeps its colour on every screen.
 * Values mirror the --purpose-N tokens in globals.css (SVG needs them as plain values).
 */
export const PURPOSE_FILLS = ["#2bc4ba", "#9b8cf2", "#f2896d", "#f5b83d", "#5aa9f5", "#8fcb5a"] as const;

/** Text colour that reads on each fill (indigo on light fills, white on dark ones). */
const TEXT_ON = ["#0e1c2b", "#0e1c2b", "#0e1c2b", "#0e1c2b", "#0e1c2b", "#0e1c2b"] as const;

export const INK = "#0e1c2b";
export const TEAL = "#0fa39a";
export const MIST = "#f3f7f8";
export const WHITE = "#ffffff";

export function purposeFill(index: number): string {
  return PURPOSE_FILLS[index % PURPOSE_FILLS.length]!;
}

export function textOnPurpose(index: number): string {
  return TEXT_ON[index % TEXT_ON.length]!;
}
