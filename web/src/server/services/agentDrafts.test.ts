import { describe, expect, it } from "vitest";
import type { DraftModel, DraftResult } from "../agent/model";
import type { Ctx } from "../context";
import { AppError } from "../errors";
import { signedInUser, testCtx } from "../testing";
import { draftPayout } from "./agentDrafts";

const A1 = "0x00000000000000000000000000000000000000a1";
const good = { split: "each", pot: null, label: "Prizes", lines: [{ who: A1, amount: "5", purpose: null }], notes: [] };

/** A model that answers from a script and counts calls; "stall" never answers. */
function scripted(answers: unknown[]): DraftModel & { calls: number } {
  const m = {
    id: "fake",
    calls: 0,
    async draft(): Promise<DraftResult> {
      const a = answers[Math.min(m.calls++, answers.length - 1)];
      if (a === "stall") return new Promise(() => {});
      if (a instanceof Error) throw a;
      return { output: a, usage: { input: 10, output: 5 } };
    },
  };
  return m;
}

async function setup(env: Record<string, string> = {}, model?: DraftModel | null) {
  const t = await testCtx(env);
  const ctx: Ctx = model === undefined ? t.ctx : { ...t.ctx, agent: model };
  const { user } = await signedInUser(ctx, "ada@example.com");
  return { ...t, ctx, user };
}

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return { status: e.status, code: e.code, message: e.message };
    throw e;
  }
  throw new Error("expected a failure");
}

describe("agent drafts", () => {
  it("fills the composer from a description", async () => {
    const { ctx, user } = await setup();
    const fill = await draftPayout(ctx, user, { text: `${A1}, 5, prize`, files: [] });
    expect(fill).toEqual({ mode: "each", text: `${A1}, 5.00, prize`, pot: "", label: "", notes: [] });
  });

  it("is off without a model", async () => {
    const { ctx, user } = await setup({}, null);
    expect(await failure(draftPayout(ctx, user, { text: "x", files: [] }))).toMatchObject({ status: 404, code: "AGENT_OFF" });
  });

  it("stops at the daily cap and says when more are allowed", async () => {
    const { ctx, user } = await setup({ AGENT_DRAFTS_PER_DAY: "2" });
    await draftPayout(ctx, user, { text: `${A1}, 1`, files: [] });
    await draftPayout(ctx, user, { text: `${A1}, 1`, files: [] });
    expect(await failure(draftPayout(ctx, user, { text: `${A1}, 1`, files: [] }))).toEqual({
      status: 429,
      code: "TOO_MANY_DRAFTS",
      message: "You've used today's 2 drafts. More at 00:00 UTC.",
    });
  });

  it("stops at the global hourly cap across people", async () => {
    const { ctx, user } = await setup({ AGENT_DRAFTS_GLOBAL_PER_HOUR: "1" });
    await draftPayout(ctx, user, { text: `${A1}, 1`, files: [] });
    const { user: bola } = await signedInUser(ctx, "bola@example.com");
    expect(await failure(draftPayout(ctx, bola, { text: `${A1}, 1`, files: [] }))).toEqual({
      status: 429,
      code: "TOO_MANY_DRAFTS",
      message: "Agentic mode is busy right now. Try again at 10:00 UTC.",
    });
  });

  it("stops at the global daily cap, so a full hourly cap can't run all day", async () => {
    const { ctx, user, clock } = await setup({ AGENT_DRAFTS_GLOBAL_PER_HOUR: "5", AGENT_DRAFTS_GLOBAL_PER_DAY: "2" });
    await draftPayout(ctx, user, { text: `${A1}, 1`, files: [] });
    clock.advance(60 * 60_000);
    await draftPayout(ctx, user, { text: `${A1}, 1`, files: [] });
    clock.advance(60 * 60_000);
    expect(await failure(draftPayout(ctx, user, { text: `${A1}, 1`, files: [] }))).toMatchObject({ status: 429, code: "TOO_MANY_DRAFTS" });
  });

  it("doesn't spend the person's daily draft when the service is busy", async () => {
    const { ctx, user, clock } = await setup({ AGENT_DRAFTS_GLOBAL_PER_HOUR: "1", AGENT_DRAFTS_PER_DAY: "1" });
    const { user: bola } = await signedInUser(ctx, "bola@example.com");
    await draftPayout(ctx, bola, { text: `${A1}, 1`, files: [] });
    expect((await failure(draftPayout(ctx, user, { text: `${A1}, 1`, files: [] }))).message).toContain("busy");
    clock.advance(3_600_000);
    expect((await draftPayout(ctx, user, { text: `${A1}, 1`, files: [] })).text).toBe(`${A1}, 1.00`);
  });

  it("counts every model attempt against the hourly cap, retries included", async () => {
    const model = scripted([{ nope: true }, good]);
    const { ctx, user } = await setup({ AGENT_DRAFTS_GLOBAL_PER_HOUR: "1" }, model);
    expect(await failure(draftPayout(ctx, user, { text: "list", files: [] }))).toMatchObject({ status: 503, code: "AGENT_UNAVAILABLE" });
    expect(model.calls).toBe(1);
  });

  it("refuses bad input before the model and without using a draft (Review Focus 4)", async () => {
    const model = scripted([good]);
    const { ctx, user } = await setup({ AGENT_DRAFTS_PER_DAY: "1" }, model);
    expect((await failure(draftPayout(ctx, user, { text: "  ", files: [] }))).code).toBe("EMPTY_DRAFT");
    expect((await failure(draftPayout(ctx, user, { text: "", files: [{ name: "a.png", bytes: new Uint8Array([1, 2, 3]) }] }))).code).toBe("IMAGE_TYPE");
    expect(model.calls).toBe(0);
    await draftPayout(ctx, user, { text: "list", files: [] });
    expect(model.calls).toBe(1);
  });

  it("tries once more when the answer has the wrong shape", async () => {
    const model = scripted([{ nope: true }, good]);
    const { ctx, user } = await setup({}, model);
    expect((await draftPayout(ctx, user, { text: "list", files: [] })).text).toBe(`${A1}, 5.00`);
    expect(model.calls).toBe(2);
  });

  it("gives up after two wrong shapes", async () => {
    const model = scripted([{ nope: 1 }, null]);
    const { ctx, user } = await setup({}, model);
    expect(await failure(draftPayout(ctx, user, { text: "list", files: [] }))).toMatchObject({ status: 503, code: "AGENT_UNAVAILABLE" });
    expect(model.calls).toBe(2);
  });

  it("gives up when the model is slow or failing, without a retry", async () => {
    for (const answer of ["stall", new Error("ThrottlingException")]) {
      const model = scripted([answer]);
      const { ctx, user } = await setup({}, model);
      expect(await failure(draftPayout(ctx, user, { text: "list", files: [] }, { timeoutMs: 50 }))).toEqual({
        status: 503,
        code: "AGENT_UNAVAILABLE",
        message: "Couldn't read that right now. Your text and screenshots are still here. Try again.",
      });
      expect(model.calls).toBe(1);
    }
  });

  it("doesn't retry an answer cut off at the output limit, and says to split the list", async () => {
    let calls = 0;
    const model: DraftModel = {
      id: "fake",
      async draft() {
        calls++;
        return { output: { split: "each", lines: [{ who: "0x00" }] }, usage: { input: 10, output: 6000 }, truncated: true };
      },
    };
    const { ctx, user } = await setup({}, model);
    expect(await failure(draftPayout(ctx, user, { text: "a very long list", files: [] }))).toEqual({
      status: 422,
      code: "TOO_LONG",
      message: "That's too many people to read in one go. Split it into two drafts.",
    });
    expect(calls).toBe(1);
  });

  it("says when nobody to pay was found", async () => {
    const { ctx, user } = await setup({}, scripted([{ ...good, lines: [] }]));
    expect(await failure(draftPayout(ctx, user, { text: "hello", files: [] }))).toMatchObject({ status: 422, code: "NOTHING_FOUND" });
  });
});
