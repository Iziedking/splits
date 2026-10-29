import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessages, ChatPanel, rememberChat, savedChatId, TalkToUs, type ChatPanelProps, type ChatView } from "./support-chat";

const noop = () => {};
const panel = (over: Partial<ChatPanelProps> = {}) =>
  renderToStaticMarkup(
    <ChatPanel view={null} initialRef={null} supportEmail="support@mysplits.xyz" text="" sending={false} error={null} onText={noop} onSend={noop} onPerson={noop} {...over} />,
  );

const handedOver: ChatView = {
  id: "c1",
  ref: "8F3C12AA0B1C",
  status: "handed_over",
  messages: [
    { role: "person", text: "Where is my money?", at: "2026-10-29T10:00:00.000Z" },
    { role: "agent", text: "We've passed this to the Splits team. A person will reply to ada@example.com within 24 hours.", at: "2026-10-29T10:00:02.000Z" },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("the support chat", () => {
  it('renders action lines with "Done:"', () => {
    const out = renderToStaticMarkup(<ChatMessages messages={[{ role: "action", text: "Checked payment 8F3C12AA0B1C again: Delivered.", at: "" }]} />);
    expect(out).toContain('<span class="sr-only">Done: </span>Checked payment 8F3C12AA0B1C again: Delivered.');
  });

  it("the log is polite-live", () => {
    const out = renderToStaticMarkup(<ChatMessages messages={[]} />);
    expect(out).toContain('role="log"');
    expect(out).toContain('aria-live="polite"');
  });

  it("an open chat has the input and the way to a person", () => {
    const out = panel();
    expect(out).toContain("<textarea");
    expect(out).toContain('maxLength="1000"');
    expect(out).toContain("Talk to a person");
    expect(out).toContain("It can&#x27;t move");
  });

  it("hand-over state shows the 24-hour line and no input", () => {
    const out = panel({ view: handedOver });
    expect(out).toContain("A person will reply to ada@example.com within 24 hours");
    expect(out).not.toContain("<textarea");
  });

  it("an error offers the email, with the reference", () => {
    const out = panel({ error: "The agent is busy right now.", initialRef: "8F3C12AA0B1C" });
    expect(out).toContain("The agent is busy right now.");
    expect(out).toContain("mailto:support@mysplits.xyz?subject=Help%20with%20payment%208F3C12AA0B1C");
  });

  it("counts down only near the limit", () => {
    expect(panel({ text: "a".repeat(800) })).not.toContain("characters left");
    expect(panel({ text: "a".repeat(801) })).toContain("199 characters left");
  });

  it("SupportChat loads an existing chat id from sessionStorage, and survives storage that throws", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } });
    rememberChat("c1");
    expect(savedChatId()).toBe("c1");
    rememberChat(null);
    expect(savedChatId()).toBeNull();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(savedChatId()).toBeNull();
    expect(() => rememberChat("c1")).not.toThrow();
  });
});

describe("Talk to us", () => {
  it("offers the chat only when the agent is on and the person is signed in", () => {
    const on = renderToStaticMarkup(<TalkToUs agentOn signedIn initialRef={null} supportEmail="support@mysplits.xyz" />);
    expect(on).toContain("Chat with us");
    expect(on).toContain("mailto:support@mysplits.xyz");
    for (const [agentOn, signedIn] of [
      [false, true],
      [true, false],
    ]) {
      const off = renderToStaticMarkup(<TalkToUs agentOn={agentOn!} signedIn={signedIn!} initialRef={null} supportEmail="support@mysplits.xyz" />);
      expect(off).not.toContain("Chat with us");
      expect(off).toContain("Email support@mysplits.xyz");
    }
  });
});
