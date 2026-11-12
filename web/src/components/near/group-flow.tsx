"use client";

import { Check, Users, Vote, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Notice, inputClass } from "@/components/ui/field";
import { NEAR, accountUrl, txUrl } from "@/lib/near/config";
import { councilOf, createDaoTx, isDaoName, proposedShares, proposeTx, voteTx, type DaoConfig, type Policy, type Proposal } from "@/lib/near/dao";
import type { Share } from "@/lib/near/instruction";
import { formatNear, isAccountId, normaliseAccount } from "@/lib/near/payment";
import { finalTx, getSplit, view, type SavedSplit } from "@/lib/near/rpc";
import { cn } from "@/lib/utils";
import { AccountName } from "./split-card";
import { SharesList } from "./split-flow";
import { useNearWallet } from "./wallet";

type Group = { config: DaoConfig; policy: Policy; council: string[]; split: SavedSplit | null; proposals: (Proposal & { shares: Share[] })[] };

async function loadGroup(dao: string): Promise<Group> {
  const [config, policy, last, split] = await Promise.all([
    view<DaoConfig>(dao, "get_config"),
    view<Policy>(dao, "get_policy"),
    view<number>(dao, "get_last_proposal_id"),
    getSplit(dao).catch(() => null),
  ]);
  const from = Math.max(0, last - 30);
  const all = last > 0 ? await view<Proposal[]>(dao, "get_proposals", { from_index: from, limit: 30 }) : [];
  const proposals = all
    .map((p) => ({ ...p, shares: proposedShares(p, NEAR.router) }))
    .filter((p): p is Proposal & { shares: Share[] } => p.shares !== null)
    .reverse();
  return { config, policy, council: councilOf(policy), split, proposals };
}

/**
 * A group fund: a Sputnik DAO whose split in the router is set by a vote. Open a group by its DAO
 * account, or start one; propose a split in plain words; members vote; the split changes only when
 * the vote passes, and every payment sent to the group then divides by it.
 */
export function GroupFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const dao = normaliseAccount(params.get("dao") ?? "");
  const open = (id: string) => router.push(`${path}?dao=${encodeURIComponent(id)}`);

  if (!dao || !isAccountId(dao)) return <ChooseGroup onOpen={open} />;
  return <GroupView key={dao} dao={dao} onOpen={open} />;
}

function ChooseGroup({ onOpen }: { onOpen: (dao: string) => void }) {
  const { accountId, signIn, send } = useNearWallet();
  const [existing, setExisting] = React.useState("");
  const [name, setName] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [members, setMembers] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (accountId) setMembers((m) => m || accountId);
  }, [accountId]);

  const memberList = members.split(/[\s,]+/).map(normaliseAccount).filter(Boolean);
  const badMember = memberList.find((m) => !isAccountId(m));

  async function onCreate() {
    setError(null);
    if (!isDaoName(name)) return setError("Use 2 to 32 lowercase letters, digits, - or _ for the group's name.");
    if (!memberList.length || badMember) return setError(badMember ? `${badMember} isn't a NEAR account` : "Add at least one member");
    setBusy(true);
    try {
      const hash = await send(createDaoTx(NEAR.daoFactory, name, purpose.trim() || "A group fund on Splits", memberList));
      await finalTx(hash, accountId!);
      onOpen(`${name}.${NEAR.daoFactory}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The group was not created");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="open-title" className="surface h-fit rounded-2xl p-6 sm:p-7">
        <h2 id="open-title" className="text-lg font-semibold">
          Open your group
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Any Sputnik DAO on NEAR {NEAR.network} works. Its council votes on the split.</p>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            const id = normaliseAccount(existing);
            if (isAccountId(id)) onOpen(id);
          }}
        >
          <label htmlFor="dao-account" className="sr-only">
            The group&apos;s DAO account
          </label>
          <input id="dao-account" className={cn(inputClass, "font-mono text-sm")} placeholder={`flatmates.${NEAR.daoFactory}`} value={existing} onChange={(e) => setExisting(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={!isAccountId(normaliseAccount(existing))}>
            Open
          </Button>
        </form>
      </section>

      <section aria-labelledby="start-title" className="surface rounded-2xl p-6 sm:p-7">
        <h2 id="start-title" className="text-lg font-semibold">
          Start a group
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A flat, a trip, a team: a Sputnik DAO whose members vote once on how the group&apos;s money divides. Founding it costs 6 test NEAR,
          which stays in the group&apos;s account.
        </p>
        <div className="mt-4 space-y-4">
          <Field label="Name" hint={`It becomes ${name || "name"}.${NEAR.daoFactory}`} value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="flatmates" />
          <Field label="What it's for" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Rent, bills and the summer trip" />
          <div>
            <label htmlFor="members" className="block text-sm font-medium">
              Members who vote
            </label>
            <p className="text-xs text-muted-foreground">NEAR accounts, one per line or separated by commas. A change needs more than half of them.</p>
            <textarea id="members" className={cn(inputClass, "mt-2 min-h-24 py-3 font-mono text-sm")} value={members} onChange={(e) => setMembers(e.target.value)} />
          </div>
        </div>
        {accountId ? (
          <Button className="mt-5 w-full" busy={busy} onClick={() => void onCreate()}>
            Start the group
          </Button>
        ) : (
          <Button className="mt-5 w-full" onClick={() => void signIn()}>
            Connect a NEAR wallet to start a group
          </Button>
        )}
        {error && (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        )}
      </section>
    </div>
  );
}

function GroupView({ dao, onOpen }: { dao: string; onOpen: (dao: string) => void }) {
  const { accountId, signIn, send } = useNearWallet();
  const [group, setGroup] = React.useState<Group | null | undefined>(undefined);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");
  const [draft, setDraft] = React.useState<{ shares: Share[]; notes: string[]; by: string } | null>(null);
  const [busy, setBusy] = React.useState<null | "reading" | "proposing" | `vote-${number}`>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lastTx, setLastTx] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      setGroup(await loadGroup(dao));
      setLoadError(null);
    } catch {
      setGroup(null);
      setLoadError(`${dao} isn't a Sputnik DAO on NEAR ${NEAR.network}, or NEAR didn't answer. Check the account and try again.`);
    }
  }, [dao]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  React.useEffect(() => {
    // A starting point built from the group's own members; they edit it before proposing.
    if (group && !text && group.council.length) {
      const [a, b = a] = group.council;
      setText(`40% to ${a} for rent, 30% to ${b} for bills, the rest stays in the group fund`);
    }
  }, [group, text]);

  if (group === undefined) return <p className="text-muted-foreground">Reading the group from NEAR…</p>;
  if (group === null)
    return (
      <div className="space-y-4">
        <Notice tone="error">{loadError}</Notice>
        <Button variant="secondary" onClick={() => onOpen("")}>
          Choose another group
        </Button>
      </div>
    );

  const isMember = !!accountId && group.council.includes(accountId);
  const need = Math.floor(group.council.length / 2) + 1;

  async function run(label: typeof busy, tx: Parameters<typeof send>[0]) {
    setError(null);
    setBusy(label);
    try {
      const hash = await send(tx);
      await finalTx(hash, accountId!);
      setLastTx(hash);
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The wallet did not send it");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onRead() {
    setError(null);
    setDraft(null);
    setBusy("reading");
    try {
      const res = await fetch("/api/near/instruction", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, me: dao }) });
      const body = (await res.json()) as { shares?: Share[]; notes?: string[]; by?: string; error?: string };
      if (!res.ok || !body.shares) throw new Error(body.error ?? "Could not read that");
      setDraft({ shares: body.shares, notes: body.notes ?? [], by: body.by ?? "rules" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-primary-fill p-6 text-white sm:p-8">
        <div aria-hidden="true" className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-purpose-2/45 blur-[90px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm text-white/75">
              <Users className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              Group fund
            </p>
            <h2 className="display-face mt-1 text-3xl font-bold">{group.config.name}</h2>
            {group.config.purpose && <p className="mt-1 text-white/80">{group.config.purpose}</p>}
            <a href={accountUrl(dao)} target="_blank" rel="noreferrer" className="mt-3 inline-block font-mono text-[0.8125rem] break-all text-white/85 underline-offset-4 hover:underline">
              {dao}
            </a>
          </div>
          <div>
            <p className="text-sm text-white/75">
              {group.council.length} {group.council.length === 1 ? "member votes" : "members vote"}; a change needs {need}
            </p>
            <ul className="mt-2 space-y-1">
              {group.council.map((m) => (
                <li key={m} className="flex items-center gap-2 font-mono text-[0.8125rem]">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-white/70" />
                  {m}
                  {m === accountId && <span className="font-sans text-xs text-white/70">(you)</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="rule-title" className="surface h-fit rounded-2xl p-6 sm:p-7">
          <h2 id="rule-title" className="text-lg font-semibold">
            The group&apos;s split now
          </h2>
          {group.split ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">Version {group.split.version}, set by a vote. Every payment sent to the group through Splits divides like this.</p>
              <SharesList shares={group.split.shares} />
              <Link className="mt-4 inline-block text-sm font-medium text-primary-text underline-offset-4 hover:underline" href={`/near/pay/${dao}`}>
                The group&apos;s pay link
              </Link>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No split voted yet, so money sent to the group stays in the group&apos;s account. Propose one below.</p>
          )}
        </section>

        <section aria-labelledby="propose-title" className="surface rounded-2xl p-6 sm:p-7">
          <h2 id="propose-title" className="text-lg font-semibold">
            Propose a split
          </h2>
          <label htmlFor="group-rule" className="mt-1 block text-sm text-muted-foreground">
            In plain words: who gets what share, and what it&apos;s for. Whatever you don&apos;t give away stays in the group fund.
          </label>
          <textarea id="group-rule" className={cn(inputClass, "mt-3 min-h-28 py-3")} value={text} onChange={(e) => (setText(e.target.value), setDraft(null))} />
          <Button className="mt-3 w-full" variant="secondary" busy={busy === "reading"} disabled={!text.trim()} onClick={() => void onRead()}>
            Turn it into a split
          </Button>
          {draft && (
            <div className="mt-5">
              <p className="text-sm font-semibold">What the group would vote on</p>
              <SharesList shares={draft.shares} />
              {draft.notes.map((n) => (
                <Notice key={n} className="mt-2">
                  {n}
                </Notice>
              ))}
              <p className="mt-3 text-xs text-muted-foreground">
                {draft.by === "near-ai" ? "Read by NEAR AI, then checked by Splits." : "Read by Splits' rules."} Proposing asks your wallet for the group&apos;s{" "}
                {formatNear(BigInt(group.policy.proposal_bond))} NEAR bond, which the DAO returns once the group decides.
              </p>
              {accountId ? (
                <Button
                  className="mt-3 w-full"
                  busy={busy === "proposing"}
                  disabled={draft.shares.length === 0}
                  onClick={async () => {
                    if (await run("proposing", proposeTx(dao, NEAR.router, draft.shares, group.policy.proposal_bond))) setDraft(null);
                  }}
                >
                  Ask the group to vote
                </Button>
              ) : (
                <Button className="mt-3 w-full" onClick={() => void signIn()}>
                  Connect a NEAR wallet to propose
                </Button>
              )}
            </div>
          )}
        </section>
      </div>

      {(error || lastTx) && (
        <div className="space-y-2">
          {error && <Notice tone="error">{error}</Notice>}
          {lastTx && !error && (
            <Notice tone="success">
              Done on NEAR.{" "}
              <a className="underline" href={txUrl(lastTx)} target="_blank" rel="noreferrer">
                See the transaction
              </a>
            </Notice>
          )}
        </div>
      )}

      <section aria-labelledby="votes-title">
        <h2 id="votes-title" className="text-lg font-semibold">
          Votes on the split
        </h2>
        {group.proposals.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No split has been proposed to this group yet.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {group.proposals.map((p) => {
              const yes = Object.values(p.votes).filter((v) => v === "Approve").length;
              const no = Object.values(p.votes).filter((v) => v === "Reject").length;
              const voted = accountId ? p.votes[accountId] : undefined;
              return (
                <li key={p.id} className="surface rounded-2xl p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      Proposal {p.id} by <span className="font-mono text-[0.8125rem] text-foreground">{p.proposer}</span>
                    </p>
                    <Status status={p.status} />
                  </div>
                  <SharesList shares={p.shares} />
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
                      <Vote className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                      {yes} of {need} yes votes needed{no ? `, ${no} no` : ""}
                      {voted && <span>· you voted {voted === "Approve" ? "yes" : "no"}</span>}
                    </p>
                    {p.status === "InProgress" && isMember && !voted && (
                      <div className="flex gap-2">
                        <Button size="sm" busy={busy === `vote-${p.id}`} onClick={() => void run(`vote-${p.id}`, voteTx(dao, p, true))}>
                          <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          Vote yes
                        </Button>
                        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run(`vote-${p.id}`, voteTx(dao, p, false))}>
                          <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          Vote no
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <button type="button" className="text-sm font-medium text-primary-text underline-offset-4 hover:underline" onClick={() => onOpen("")}>
        Open another group
      </button>
    </div>
  );
}

function Status({ status }: { status: Proposal["status"] }) {
  const text: Record<Proposal["status"], string> = {
    InProgress: "Voting",
    Approved: "Passed: the split changed",
    Rejected: "Voted down",
    Removed: "Removed",
    Expired: "Expired",
    Moved: "Moved",
    Failed: "Passed, but the call failed",
  };
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        status === "Approved" ? "bg-success/15 text-success-text" : status === "InProgress" ? "bg-primary/12 text-primary-text" : "bg-foreground/6 text-muted-foreground",
      )}
    >
      {text[status]}
    </span>
  );
}
