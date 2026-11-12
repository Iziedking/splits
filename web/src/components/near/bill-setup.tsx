"use client";

import { ExternalLink, Plus, Share2, X } from "lucide-react";
import * as React from "react";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Field, Notice, inputClass } from "@/components/ui/field";
import { billPath, billProblems, equalParts, hostShare, newBillId, withTip, type Bill } from "@/lib/near/bill";
import { NEAR } from "@/lib/near/config";
import { CENT, formatUnits, normaliseAccount, parseCents } from "@/lib/near/payment";
import { cn } from "@/lib/utils";
import { Copyable } from "./button-setup";
import { useNearWallet } from "./wallet";

type Row = { name: string; account: string; amount: string };

const TIPS = [
  { value: "0", label: "No tip" },
  { value: "10", label: "10%" },
  { value: "15", label: "15%" },
  { value: "20", label: "20%" },
];

/** The example a first-time visitor can fill in one tap: four friends, one dinner. */
const EXAMPLE = {
  title: "Dinner at Yellow Chilli",
  name: "Ada",
  subtotal: "54.00",
  tip: "10",
  rows: [
    { name: "Bo", account: "", amount: "" },
    { name: "Chi", account: "", amount: "" },
    { name: "Dayo", account: "", amount: "" },
  ],
};

/**
 * Set up a bill to split: what it was, the total and the tip, and who owes what. The friend who
 * paid gets a link to share; nothing is saved anywhere, the link is the bill.
 */
export function BillSetup() {
  const { accountId, signIn } = useNearWallet();
  const [id] = React.useState(() => newBillId());
  const [title, setTitle] = React.useState("");
  const [name, setName] = React.useState("");
  const [subtotal, setSubtotal] = React.useState("");
  const [tip, setTip] = React.useState("0");
  const [mode, setMode] = React.useState<"equal" | "amounts">("equal");
  const [rows, setRows] = React.useState<Row[]>([{ name: "", account: "", amount: "" }]);
  const [origin, setOrigin] = React.useState("");
  const [shared, setShared] = React.useState(false);

  React.useEffect(() => setOrigin(window.location.origin), []);

  const cents = parseCents(subtotal);
  const total = cents === null ? 0n : withTip(cents * CENT, Number(tip));
  const equal = equalParts(total, rows.length);
  const amountOf = (r: Row) => (mode === "equal" ? equal.each : (parseCents(r.amount) ?? 0n) * CENT);

  const bill: Bill = {
    id,
    title,
    host: accountId ?? "",
    hostName: name,
    total,
    people: rows.map((r) => ({ name: r.name, account: normaliseAccount(r.account), amount: amountOf(r) })),
  };
  const problems = [...(cents === null ? ["Enter the bill, like 54 or 54.50."] : []), ...billProblems(bill)];
  const ready = problems.length === 0;
  const url = ready && origin ? `${origin}${billPath(bill)}` : null;
  const started = Boolean(title || subtotal || rows.some((r) => r.name || r.account));

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function share() {
    if (!url) return;
    const text = `${name.trim() || "I"} paid for ${title.trim()}. Pay your part here:`;
    try {
      if (navigator.share) await navigator.share({ title: title.trim(), text, url });
      else {
        await navigator.clipboard?.writeText(`${text} ${url}`);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {
      // The person closed the share sheet; nothing to do.
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section aria-labelledby="bill-title" className="surface rounded-3xl p-6 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="bill-title" className="text-lg font-semibold">
            The bill
          </h2>
          <button
            type="button"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-text underline-offset-4 hover:underline"
            onClick={() => (setTitle(EXAMPLE.title), setName(EXAMPLE.name), setSubtotal(EXAMPLE.subtotal), setTip(EXAMPLE.tip), setMode("equal"), setRows(EXAMPLE.rows))}
          >
            Fill the dinner example
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="What was it?" placeholder="Dinner at Yellow Chilli" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Field label="Your name" placeholder="Ada" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Field className="mt-4" label={`The bill (${NEAR.tokenSymbol})`} inputMode="decimal" placeholder="54.00" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} />

        <div className="mt-4">
          <p className="mb-1.5 text-sm font-medium">Tip</p>
          <Segmented kind="radio" label="Tip" options={TIPS} value={tip} onChange={setTip} />
        </div>

        <div className="mt-6">
          <p className="mb-1.5 text-sm font-medium">How to split it</p>
          <Segmented
            kind="radio"
            label="How to split it"
            options={[
              { value: "equal", label: "Equally" },
              { value: "amounts", label: "By what each had" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as "equal" | "amounts")}
          />
        </div>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium">Who owes you</legend>
          <ul className="mt-2 space-y-3">
            {rows.map((r, i) => (
              <li key={i} className="rounded-2xl bg-white/60 p-3 ring-1 ring-white">
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`Friend ${i + 1}: name`}
                    className={cn(inputClass, "text-base lg:text-sm")}
                    placeholder="Name"
                    value={r.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                  {rows.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove friend ${i + 1}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className={cn("mt-2 grid gap-2", mode === "amounts" && "grid-cols-[1fr_7rem]")}>
                  <input
                    aria-label={`Friend ${i + 1}: NEAR account`}
                    className={cn(inputClass, "font-mono text-base lg:text-sm")}
                    placeholder="their-wallet.testnet"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={r.account}
                    onChange={(e) => update(i, { account: e.target.value })}
                  />
                  {mode === "amounts" && (
                    <input
                      aria-label={`Friend ${i + 1}: what they owe`}
                      className={cn(inputClass, "text-base lg:text-sm")}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={r.amount}
                      onChange={(e) => update(i, { amount: e.target.value })}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
          {rows.length < 20 && (
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => setRows((rs) => [...rs, { name: "", account: "", amount: "" }])}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add a friend
            </Button>
          )}
        </fieldset>

        {total > 0n && (
          <dl className="mt-6 space-y-2 rounded-2xl bg-white/60 p-4 text-sm ring-1 ring-white">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Bill with tip</dt>
              <dd className="font-semibold tabular-nums">
                {formatUnits(total)} {NEAR.tokenSymbol}
              </dd>
            </div>
            {mode === "equal" && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Each friend pays</dt>
                <dd className="font-semibold tabular-nums">
                  {formatUnits(equal.each)} {NEAR.tokenSymbol}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Your own part</dt>
              <dd className="font-semibold tabular-nums">
                {formatUnits(hostShare(bill) < 0n ? 0n : hostShare(bill))} {NEAR.tokenSymbol}
              </dd>
            </div>
          </dl>
        )}

        {!ready && started && accountId && (
          <Notice className="mt-4">
            <ul className="space-y-1">
              {problems.slice(0, 4).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Notice>
        )}
      </section>

      <section aria-labelledby="link-title" className="space-y-4 lg:sticky lg:top-8 lg:self-start">
        <div className="surface rounded-3xl p-6 sm:p-7">
          <h2 id="link-title" className="text-lg font-semibold">
            Send it to your friends
          </h2>
          {!accountId ? (
            <>
              <p className="mt-2 text-sm text-muted-foreground">Connect the wallet you want to be paid back to. Your friends pay straight into it.</p>
              <Button className="mt-4 w-full" onClick={() => void signIn()}>
                Connect wallet
              </Button>
            </>
          ) : url ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">Each friend opens it, connects their wallet and pays their part to {accountId}. You see who has paid on the same page.</p>
              <Button className="mt-4 w-full" onClick={() => void share()}>
                <Share2 className="h-4 w-4" aria-hidden="true" />
                {shared ? "Copied, paste it in your chat" : "Share the bill"}
              </Button>
              <Copyable className="mt-4" label="Or copy the link" value={url} />
              <a className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary-text underline-offset-4 hover:underline" href={url}>
                Open the bill
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Fill in the bill and your friends&rsquo; wallets, and the link to share appears here.</p>
          )}
        </div>
        <p className="px-2 text-xs text-muted-foreground">The bill travels in its link, so nothing is stored here. Each friend&rsquo;s payment goes straight to you; Splits never holds the money.</p>
      </section>
    </div>
  );
}
