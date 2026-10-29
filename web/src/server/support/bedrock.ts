import { BedrockRuntimeClient, ConverseCommand, type ContentBlock, type ConverseCommandOutput, type Message } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import type { SupportModel, SupportTurn } from "./model";
import { SUPPORT_PROMPT } from "./prompt";
import { TOOLS } from "./tools";

type Sender = { send(command: ConverseCommand, options: { abortSignal: AbortSignal }): Promise<ConverseCommandOutput> };

/** The chat as Converse turns. Neighbouring blocks from the same side share one message, as Converse requires. */
export function toConverse(history: SupportTurn[]): Message[] {
  const out: Message[] = [];
  for (const turn of history) {
    const role = turn.role === "person" || turn.role === "tool_result" ? "user" : "assistant";
    const block: ContentBlock =
      turn.role === "tool_call"
        ? { toolUse: { toolUseId: turn.id, name: turn.name, input: (turn.input ?? {}) as never } }
        : turn.role === "tool_result"
          ? { toolResult: { toolUseId: turn.id, content: [{ text: turn.text }] } }
          : { text: turn.text };
    const last = out.at(-1);
    if (last?.role === role) last.content!.push(block);
    else out.push({ role, content: [block] });
  }
  return out;
}

export function bedrockSupportModel(opts: { modelId: string; region: string; client?: Sender }): SupportModel {
  const client: Sender = opts.client ?? new BedrockRuntimeClient({ region: opts.region });
  // The SDK types JSON documents loosely; these are plain JSON Schemas from zod.
  const tools = TOOLS.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: z.toJSONSchema(t.input, { io: "input" }) as never } } }));
  return {
    id: opts.modelId,
    async reply(history, context, signal) {
      const about = context.ref ? `\n\nThe person opened this chat from payment ${context.ref}.` : "";
      const res = await client.send(
        new ConverseCommand({
          modelId: opts.modelId,
          system: [{ text: SUPPORT_PROMPT + about }],
          messages: toConverse(history),
          // Current Claude models refuse a temperature (Bedrock ValidationException, seen 2026-10-12); others get 0.
          inferenceConfig: opts.modelId.includes("anthropic.") ? { maxTokens: 1200 } : { temperature: 0, maxTokens: 1200 },
          toolConfig: { tools, toolChoice: { auto: {} } },
        }),
        { abortSignal: signal },
      );
      const content = res.output?.message?.content ?? [];
      const text = content.map((c) => c.text ?? "").join("").trim();
      return {
        text: text || null,
        calls: content.flatMap((c) => (c.toolUse?.name ? [{ id: c.toolUse.toolUseId ?? c.toolUse.name, name: c.toolUse.name, input: c.toolUse.input ?? {} }] : [])),
        usage: { input: res.usage?.inputTokens ?? 0, output: res.usage?.outputTokens ?? 0 },
      };
    },
  };
}
