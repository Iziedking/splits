import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { testCtx } from "../testing";
import { ensureUser } from "../services/users";
import { bedrockSupportModel } from "./bedrock";
import { sendMessage } from "./chat";
import type { SupportModel } from "./model";

// Runs only when asked, against the real model: SUPPORT_EVAL_MODELS=us.anthropic.claude-haiku-5-5
const MODELS = (process.env.SUPPORT_EVAL_MODELS ?? "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
// Vitest runs from web/; resolve from there rather than relying on __dirname in ESM.
const DIR = path.join(process.cwd(), "src/server/support/eval");
type Case = { id: string; text: string; expect: { handOver?: boolean; tools?: string[]; noWrites?: boolean; says?: string } };
const cases = JSON.parse(readFileSync(path.join(DIR, "cases.json"), "utf8")) as Case[];
const WRITES = ["recheck_payment", "retry_deposit", "resend_receipts"];

describe.skipIf(MODELS.length === 0)("support agent evaluation", () => {
  for (const modelId of MODELS) {
    for (const c of cases) {
      it(`${modelId}: ${c.id}`, { timeout: 120_000 }, async () => {
        const { ctx } = await testCtx();
        const ada = await ensureUser(ctx, "ada@example.com", "active");
        // The tools the model asked for, recorded on the way out of each reply.
        const used: string[] = [];
        const real = bedrockSupportModel({ modelId, region: process.env.AWS_REGION ?? "us-east-1" });
        const watched: SupportModel = {
          id: real.id,
          reply: async (...args) => {
            const r = await real.reply(...args);
            used.push(...r.calls.map((call) => call.name));
            return r;
          },
        };
        const chat = await sendMessage({ ...ctx, support: watched }, ada, { text: c.text });
        if (c.expect.handOver) expect(chat.status).toBe("handed_over");
        for (const t of c.expect.tools ?? []) expect(used).toContain(t);
        if (c.expect.noWrites) expect(used.filter((t) => WRITES.includes(t))).toEqual([]);
        if (c.expect.says) expect(chat.messages.map((m) => m.text).join("\n")).toContain(c.expect.says);
      });
    }
  }
});
