"use client";

import { Check, MessageCircle } from "lucide-react";
import * as React from "react";
import { Sheet } from "@/components/app/sheet";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";
import { supportMailto } from "@/lib/support";
import { cn } from "@/lib/utils";

export type ChatMessage = { role: "person" | "agent" | "action"; text: string; at: string };
export type ChatView = { id: string; ref: string | null; status: "open" | "handed_over" | "closed"; messages: ChatMessage[] };

const MAX = 1000;
const KEY = "splits.supportChat";

/** The chat this tab was in, so a reload picks it up again. Storage can be missing or throw; then there's none. */
export function savedChatId(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberChat(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(KEY, id);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Remembering is a convenience; the chat works without it.
  }
}

/** The conversation. What the agent did shows as its own line, so nobody has to take its word for it. */
export function ChatMessages({ messages }: { messages: ChatMessage[] }) {
  return (
    <ol role="log" aria-live="polite" aria-label="Conversation" className="space-y-3">
      {messages.map((m, i) =>
        m.role === "action" ? (
          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary-text" aria-hidden="true" />
            <span>
              <span className="sr-only">Done: </span>
              {m.text}
            </span>
          </li>
        ) : (
          <li
            key={i}
            className={cn(
              "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap",
              m.role === "person" ? "ml-auto bg-primary/10" : "bg-muted",
            )}
          >
            <span className="sr-only">{m.role === "person" ? "You: " : "Agent: "}</span>
            {m.text}
          </li>
        ),
      )}
    </ol>
  );
}

export type ChatPanelProps = {
  view: ChatView | null;
  initialRef: string | null;
  supportEmail: string;
  text: string;
  sending: boolean;
  error: string | null;
  onText: (text: string) => void;
  onSend: () => void;
  onPerson: () => void;
};

/** Everything inside the sheet. Kept apart from the fetching so each state can be shown and tested. */
export function ChatPanel({ view, initialRef, supportEmail, text, sending, error, onText, onSend, onPerson }: ChatPanelProps) {
  const ref = view?.ref ?? initialRef;
  const open = !view || view.status === "open";
  return (
    <div className="mt-4 space-y-4">
      {view?.messages.length ? (
        <ChatMessages messages={view.messages} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Ask about a payment or money you added. The agent can look things up, check a stuck payment again and resend receipts. It can&apos;t move
          money.
        </p>
      )}
      {error && (
        <Notice tone="error">
          {error}{" "}
          <a href={supportMailto(supportEmail, ref)} className="font-semibold underline underline-offset-4">
            Email {supportEmail}
          </a>
        </Notice>
      )}
      {open && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <label className="block text-sm font-semibold" htmlFor="support-message">
            Your message
          </label>
          <textarea
            id="support-message"
            value={text}
            maxLength={MAX}
            rows={3}
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            className="w-full rounded-sm bg-white/70 px-4 py-3 text-base ring-1 ring-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          {text.length > 800 && <p className="text-xs text-muted-foreground tabular-nums">{MAX - text.length} characters left</p>}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" busy={sending} disabled={sending || !text.trim()} className="sm:flex-1">
              Send
            </Button>
            <Button type="button" variant="secondary" disabled={sending} onClick={onPerson} className="sm:flex-1">
              Talk to a person
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** The support agent in a sheet: picks up this tab's chat, sends messages, and hands over on request. */
export function SupportChat({ open, onClose, initialRef, supportEmail }: { open: boolean; onClose: () => void; initialRef: string | null; supportEmail: string }) {
  const [view, setView] = React.useState<ChatView | null>(null);
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || view) return;
    const id = savedChatId();
    if (!id) return;
    api<ChatView>(`/api/support/chat/${id}`)
      .then((v) => (initialRef && v.ref !== initialRef ? rememberChat(null) : setView(v)))
      .catch(() => rememberChat(null));
  }, [open, view, initialRef]);

  const post = async (body: { text?: string; person?: true }) => {
    setSending(true);
    setError(null);
    try {
      const next = await api<ChatView>("/api/support/chat", { method: "POST", body: { chatId: view?.id, ref: initialRef, ...body } });
      setView(next);
      rememberChat(next.id);
      if (body.text) setText("");
    } catch (err) {
      setError(errorMessage(err));
      // The server may have kept the message, or an action, before the turn failed: show the chat as it stands.
      if (view) await api<ChatView>(`/api/support/chat/${view.id}`).then(setView, () => {});
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Talk to us" description={initialRef ? `Ask about payment ${initialRef}` : undefined}>
      <ChatPanel
        view={view}
        initialRef={initialRef}
        supportEmail={supportEmail}
        text={text}
        sending={sending}
        error={error}
        onText={setText}
        onSend={() => text.trim() && !sending && void post({ text: text.trim() })}
        onPerson={() => void post({ person: true })}
      />
    </Sheet>
  );
}

/** The Help page's way in: chat when the agent is on and the person is signed in, email always. */
export function TalkToUs({ agentOn, signedIn, initialRef, supportEmail }: { agentOn: boolean; signedIn: boolean; initialRef: string | null; supportEmail: string }) {
  const [open, setOpen] = React.useState(false);
  const chat = agentOn && signedIn;
  return (
    <>
      {chat && (
        <Button className="w-full" onClick={() => setOpen(true)}>
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          Chat with us
        </Button>
      )}
      <ButtonLink href={supportMailto(supportEmail, initialRef)} variant={chat ? "secondary" : "primary"} className="w-full">
        Email {supportEmail}
      </ButtonLink>
      {chat && <SupportChat open={open} onClose={() => setOpen(false)} initialRef={initialRef} supportEmail={supportEmail} />}
    </>
  );
}
