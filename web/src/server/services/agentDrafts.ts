import { agentDraftSchema, NothingFound, toComposer, type AgentDraft, type ComposerFill } from "../agent/draft";
import { checkAgentInput, type UploadedFile } from "../agent/images";
import type { DraftResult } from "../agent/model";
import type { Ctx } from "../context";
import { AppError, tooMany, unavailable, unprocessable } from "../errors";
import { hitRateLimit, refundRateHit } from "./rateLimits";
import { windowEnds, withTimeout } from "../agent/timing";
import type { User } from "./users";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const UNAVAILABLE = "Couldn't read that right now. Your text and screenshots are still here. Try again.";

/**
 * Agentic mode: a description and screenshots in, the payout composer's fields out. The model only
 * drafts; the person checks the list and confirms with their PIN as usual. Text and images are
 * never stored or logged.
 */
export async function draftPayout(
  ctx: Ctx,
  user: User,
  raw: { text: string; files: UploadedFile[] },
  opts: { timeoutMs?: number } = {},
): Promise<ComposerFill> {
  const model = ctx.agent;
  if (!model) throw new AppError(404, "AGENT_OFF", "Agentic mode isn't available right now");
  const input = checkAgentInput(raw);

  // The person's own cap first, so someone at their cap can't use up everyone's hourly budget.
  const accountKey = `agent:u:${user.id}`;
  const perAccount = await hitRateLimit(ctx, accountKey, ctx.limits.agentDraftsPerDay, DAY);
  if (!perAccount) {
    throw tooMany("TOO_MANY_DRAFTS", `You've used today's ${ctx.limits.agentDraftsPerDay} drafts. More at ${windowEnds(ctx, DAY)} UTC.`);
  }
  // The hourly and daily caps count model calls, so they bound cost exactly (a full hour can't
  // repeat all day); a busy refusal gives the person's draft back.
  const modelCallAllowed = async (): Promise<"ok" | "hour" | "day"> => {
    if (!(await hitRateLimit(ctx, "agent:all", ctx.limits.agentDraftsGlobalPerHour, HOUR))) return "hour";
    if (!(await hitRateLimit(ctx, "agent:all:day", ctx.limits.agentDraftsGlobalPerDay, DAY))) return "day";
    return "ok";
  };
  const allowed = await modelCallAllowed();
  if (allowed !== "ok") {
    await refundRateHit(ctx, accountKey, DAY);
    throw tooMany("TOO_MANY_DRAFTS", `Agentic mode is busy right now. Try again at ${windowEnds(ctx, allowed === "hour" ? HOUR : DAY)} UTC.`);
  }

  const started = Date.now();
  const usage = { input: 0, output: 0 };
  let draft: AgentDraft | null = null;
  for (let attempt = 0; attempt < 2 && !draft; attempt++) {
    if (attempt > 0 && (await modelCallAllowed()) !== "ok") throw unavailable("AGENT_UNAVAILABLE", UNAVAILABLE);
    let result: DraftResult;
    try {
      result = await withTimeout((signal) => model.draft(input, signal), opts.timeoutMs ?? 20_000);
    } catch (err) {
      console.error(`[agent] ${model.id} call failed: ${err instanceof Error ? `${err.name} ${err.message}` : "error"}`);
      throw unavailable("AGENT_UNAVAILABLE", UNAVAILABLE);
    }
    usage.input += result.usage.input;
    usage.output += result.usage.output;
    const parsed = agentDraftSchema.safeParse(result.output);
    if (parsed.success) draft = parsed.data;
    else if (result.truncated) {
      throw unprocessable("TOO_LONG", "That's too many people to read in one go. Split it into two drafts.");
    }
  }
  if (!draft) {
    console.error(`[agent] ${model.id} answered in the wrong shape twice`);
    throw unavailable("AGENT_UNAVAILABLE", UNAVAILABLE);
  }

  let fill: ComposerFill;
  try {
    fill = toComposer(draft, ctx.limits.maxPayoutRecipients);
  } catch (err) {
    if (err instanceof NothingFound) throw unprocessable("NOTHING_FOUND", "Couldn't find anyone to pay in that. Try one person per line.");
    throw err;
  }
  // Counts only: never the text, the images or the lines themselves.
  console.info(
    `[agent] model=${model.id} images=${input.images.length} lines=${fill.text.split("\n").length} tokens_in=${usage.input} tokens_out=${usage.output} ms=${Date.now() - started}`,
  );
  return fill;
}
