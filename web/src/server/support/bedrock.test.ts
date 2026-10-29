import type { ConverseCommand, ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it } from "vitest";
import { bedrockSupportModel, toConverse } from "./bedrock";
import { SUPPORT_PROMPT } from "./prompt";
import { TOOL_NAMES } from "./tools";

const signal = () => new AbortController().signal;

function fake(content: unknown[]) {
  const sent: ConverseCommand[] = [];
  const client = {
    async send(cmd: ConverseCommand) {
      sent.push(cmd);
      return { output: { message: { role: "assistant", content } }, usage: { inputTokens: 700, outputTokens: 40 } } as unknown as ConverseCommandOutput;
    },
  };
  return { sent, client };
}

describe("bedrockSupportModel", () => {
  it("sends the tools and system prompt", async () => {
    const { sent, client } = fake([{ text: "Hi" }]);
    await bedrockSupportModel({ modelId: "us.amazon.nova-2-lite-v1:0", region: "us-east-1", client }).reply([{ role: "person", text: "hi" }], { ref: null }, signal());
    const input = sent[0]!.input;
    expect(input.toolConfig?.tools?.map((t) => t.toolSpec?.name)).toEqual([...TOOL_NAMES]);
    expect(input.toolConfig?.toolChoice).toEqual({ auto: {} });
    expect(input.system![0]!.text).toBe(SUPPORT_PROMPT);
    expect(input.inferenceConfig).toEqual({ temperature: 0, maxTokens: 1200 });
  });

  it("tells the model which payment the chat is about", async () => {
    const { sent, client } = fake([{ text: "Hi" }]);
    await bedrockSupportModel({ modelId: "m", region: "us-east-1", client }).reply([{ role: "person", text: "hi" }], { ref: "8F3C12AA0B1C" }, signal());
    expect(sent[0]!.input.system![0]!.text).toContain("payment 8F3C12AA0B1C");
  });

  it("maps history to Converse turns, merging neighbours from the same side", () => {
    expect(
      toConverse([
        { role: "person", text: "a" },
        { role: "person", text: "b" },
        { role: "tool_call", id: "t1", name: "list_payments", input: {} },
        { role: "tool_result", id: "t1", text: "none" },
        { role: "agent", text: "You have none." },
      ]),
    ).toEqual([
      { role: "user", content: [{ text: "a" }, { text: "b" }] },
      { role: "assistant", content: [{ toolUse: { toolUseId: "t1", name: "list_payments", input: {} } }] },
      { role: "user", content: [{ toolResult: { toolUseId: "t1", content: [{ text: "none" }] } }] },
      { role: "assistant", content: [{ text: "You have none." }] },
    ]);
  });

  it("returns calls and text", async () => {
    const { client } = fake([{ text: "Let me look." }, { toolUse: { toolUseId: "u1", name: "get_payment", input: { ref: "latest" } } }]);
    const reply = await bedrockSupportModel({ modelId: "m", region: "us-east-1", client }).reply([{ role: "person", text: "hi" }], { ref: null }, signal());
    expect(reply).toEqual({ text: "Let me look.", calls: [{ id: "u1", name: "get_payment", input: { ref: "latest" } }], usage: { input: 700, output: 40 } });
    const { client: plain } = fake([{ text: "Hello" }]);
    expect((await bedrockSupportModel({ modelId: "m", region: "us-east-1", client: plain }).reply([{ role: "person", text: "hi" }], { ref: null }, signal())).calls).toEqual([]);
  });

  it("omits temperature for anthropic models", async () => {
    const { sent, client } = fake([{ text: "Hi" }]);
    await bedrockSupportModel({ modelId: "us.anthropic.claude-haiku-5-5", region: "us-east-1", client }).reply([{ role: "person", text: "hi" }], { ref: null }, signal());
    expect(sent[0]!.input.inferenceConfig).toEqual({ maxTokens: 1200 });
  });
});
