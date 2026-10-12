import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePayoutLines } from "../domain/payouts";
import { bedrockModel } from "./bedrock";
import { agentDraftSchema, toComposer } from "./draft";
import { imageFormat } from "./images";

// Runs only when asked: AGENT_EVAL_MODELS=us.anthropic.claude-haiku-5-5,us.amazon.nova-2-lite-v1:0
const MODELS = (process.env.AGENT_EVAL_MODELS ?? "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
// Vitest runs from web/; resolve from there rather than relying on __dirname in ESM.
const DIR = path.join(process.cwd(), "src/server/agent/eval");
type Case = { id: string; text: string; images: string[]; split: "equal" | "each"; pot: string | null; lines: [string, string | null][] };
const cases = JSON.parse(readFileSync(path.join(DIR, "cases.json"), "utf8")) as Case[];

/** The resolvable lines (email, address or @username) as "who amount", lowercased and sorted. */
function key(text: string): string[] {
  return text
    .split("\n")
    .map((l) => {
      const p = parsePayoutLines(l)[0];
      const who = l.split(",")[0]!.trim().toLowerCase();
      const ok = p?.target || /^@[^@\s]+$/.test(who);
      return ok ? `${who} ${l.split(",")[1]?.trim() || "-"}` : null;
    })
    .filter((x): x is string => x !== null)
    .sort();
}

describe.skipIf(MODELS.length === 0)("agent model evaluation", () => {
  for (const modelId of MODELS) {
    it(`scores ${modelId}`, { timeout: 600_000 }, async () => {
      const model = bedrockModel({ modelId, region: process.env.AWS_REGION ?? "us-east-1" });
      const rows: string[] = [];
      let tokensIn = 0;
      let tokensOut = 0;
      let passed = 0;
      for (const c of cases) {
        const images = c.images.map((f) => {
          const bytes = new Uint8Array(readFileSync(path.join(DIR, f)));
          return { format: imageFormat(bytes)!, bytes };
        });
        const started = Date.now();
        const { output, usage } = await model.draft({ text: c.text, images }, AbortSignal.timeout(20_000));
        tokensIn += usage.input;
        tokensOut += usage.output;
        const parsed = agentDraftSchema.safeParse(output);
        let ok = false;
        let why = "wrong shape";
        if (parsed.success && parsed.data.lines.some((l) => l.who.trim())) {
          const fill = toComposer(parsed.data, 50);
          const want = c.lines.map(([w, a]) => `${w.toLowerCase()} ${a ?? "-"}`).sort();
          const got = key(fill.text);
          ok = fill.mode === c.split && (c.pot === null || fill.pot === c.pot) && JSON.stringify(got) === JSON.stringify(want);
          why = ok ? "" : `got ${JSON.stringify(got)} mode=${fill.mode} pot=${fill.pot}`;
        }
        if (ok) passed++;
        rows.push(`${ok ? "PASS" : "FAIL"} ${c.id} in=${usage.input} out=${usage.output} ms=${Date.now() - started} ${why}`);
      }
      console.log(`\n${modelId}: ${passed}/${cases.length} exact, tokens in=${tokensIn} out=${tokensOut}\n${rows.join("\n")}`);
      expect(rows).toHaveLength(cases.length);
    });
  }
});
