export type SupportTurn =
  | { role: "person" | "agent"; text: string }
  | { role: "tool_call"; id: string; name: string; input: unknown }
  | { role: "tool_result"; id: string; text: string };

export type SupportReply = {
  text: string | null;
  calls: { id: string; name: string; input: unknown }[];
  usage: { input: number; output: number };
};

export interface SupportModel {
  readonly id: string;
  reply(history: SupportTurn[], context: { ref: string | null }, signal: AbortSignal): Promise<SupportReply>;
}

const unwrap = (text: string) => text.replace(/<\/?message>/g, "").trim();

/**
 * Deterministic stand-in for tests, local development and preview mode. It reads the person's last
 * message for a few words, calls the matching tool, and answers with what the tool said.
 */
export function previewSupportModel(): SupportModel {
  return {
    id: "preview",
    async reply(history, context) {
      const usage = { input: 0, output: 0 };
      const last = history.at(-1);
      if (last?.role === "tool_result") return { text: last.text, calls: [], usage };
      const said = [...history].reverse().find((t) => t.role === "person");
      const text = said && "text" in said ? unwrap(said.text).toLowerCase() : "";
      const id = `preview-${history.length}`;
      const call = (name: string, input: unknown) => ({ text: null, calls: [{ id, name, input }], usage });
      if (/\b(person|human)\b/.test(text)) return call("hand_over", { summary: "The person asked to talk to a person." });
      if (text.includes("check")) return call("recheck_payment", { ref: context.ref ?? "latest" });
      if (text.includes("deposit")) return call("list_deposits", {});
      if (text.includes("receipt")) return call("resend_receipts", { ref: context.ref ?? "latest" });
      return call("get_payment", { ref: context.ref ?? "latest" });
    },
  };
}
