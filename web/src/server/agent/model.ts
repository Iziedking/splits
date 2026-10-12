import type { AgentImage } from "./images";

export type DraftInput = { text: string; images: AgentImage[] };
export type DraftResult = {
  output: unknown;
  usage: { input: number; output: number };
  /** The answer was cut off at the output limit; asking again would only cut it off again. */
  truncated?: boolean;
};

/** Turns a description into a draft list. The output is checked against agentDraftSchema by the caller. */
export interface DraftModel {
  readonly id: string;
  draft(input: DraftInput, signal: AbortSignal): Promise<DraftResult>;
}

/** Deterministic stand-in for tests, local development and preview mode: reads `who, amount, purpose` lines. */
export function previewModel(): DraftModel {
  return {
    id: "preview",
    async draft(input) {
      const lines = input.text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [who = "", amount = "", ...rest] = l.split(",").map((p) => p.trim());
          return { who, amount: amount || null, purpose: rest.join(" ").trim() || null };
        });
      const notes = input.images.length ? [{ line: null, text: "Screenshots aren't read in preview mode" }] : [];
      return {
        output: { split: lines.some((l) => l.amount) ? "each" : "equal", pot: null, label: null, lines, notes },
        usage: { input: 0, output: 0 },
      };
    },
  };
}
