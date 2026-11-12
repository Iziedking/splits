/**
 * A group fund on NEAR: a Sputnik DAO owns a saved split in the router. The group does not get new
 * voting code; it uses the DAO it already has. A member proposes a FunctionCall from the DAO to the
 * router's set_split; when the council's vote passes, the DAO makes the call and its split changes.
 * From then on every payment sent to the DAO through Splits divides by the rule the group voted on.
 * Proven end to end on testnet by near/proof/testnet-proof.mjs, check 3f.
 */

import type { Share } from "./instruction";
import type { FunctionCallAction } from "./payment";

const TGAS = 10n ** 12n;
/** What set_split may spend on storage, from the DAO's own balance; the router returns the rest. */
export const DAO_SET_SPLIT_DEPOSIT = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
/** What founding a DAO costs on testnet: the DAO account and its contract storage, held by the DAO. */
export const DAO_CREATE_DEPOSIT = 6_000_000_000_000_000_000_000_000n; // 6 NEAR

export type Role = { name: string; kind: "Everyone" | { Group: string[] } | { Member: string }; permissions: string[] };
export type Policy = { roles: Role[]; proposal_bond: string; proposal_period: string; default_vote_policy: { threshold: [number, number] | string } };
export type DaoConfig = { name: string; purpose: string; metadata: string };
export type FunctionCallKind = { FunctionCall: { receiver_id: string; actions: { method_name: string; args: string; deposit: string; gas: string }[] } };
export type Proposal = {
  id: number;
  proposer: string;
  description: string;
  kind: FunctionCallKind | Record<string, unknown>;
  status: "InProgress" | "Approved" | "Rejected" | "Removed" | "Expired" | "Moved" | "Failed";
  votes: Record<string, "Approve" | "Reject" | "Remove">;
  submission_time: string;
};

const b64 = (s: string) => (typeof btoa === "function" ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, "utf8").toString("base64"));
const unb64 = (s: string) => (typeof atob === "function" ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, "base64").toString("utf8"));

/** Accounts that can approve a proposal: every group in a role that may VoteApprove. */
export function councilOf(policy: Policy): string[] {
  const members = new Set<string>();
  for (const role of policy.roles) {
    const canVote = role.permissions.some((p) => p === "*:*" || p === "*:VoteApprove" || p === "call:VoteApprove" || p.endsWith(":VoteApprove"));
    if (!canVote || typeof role.kind !== "object") continue;
    if ("Group" in role.kind) role.kind.Group.forEach((m) => members.add(m));
    if ("Member" in role.kind) members.add(role.kind.Member);
  }
  return [...members];
}

/** The proposal kind that asks the DAO to save `shares` as its split in the router. */
export function setSplitKind(router: string, shares: Share[]): FunctionCallKind {
  return {
    FunctionCall: {
      receiver_id: router,
      actions: [{ method_name: "set_split", args: b64(JSON.stringify({ shares })), deposit: DAO_SET_SPLIT_DEPOSIT.toString(), gas: (50n * TGAS).toString() }],
    },
  };
}

/** The shares a proposal would save, if it is a set_split call to this router; otherwise null. */
export function proposedShares(p: Pick<Proposal, "kind">, router: string): Share[] | null {
  const fc = (p.kind as FunctionCallKind).FunctionCall;
  if (!fc || fc.receiver_id !== router || fc.actions.length !== 1 || fc.actions[0]!.method_name !== "set_split") return null;
  try {
    const args = JSON.parse(unb64(fc.actions[0]!.args)) as { shares?: Share[] };
    return Array.isArray(args.shares) ? args.shares : null;
  } catch {
    return null;
  }
}

export function describeShares(shares: Share[]): string {
  return `Splits: divide the group's income ${shares.map((s) => `${s.bps / 100}% ${s.purpose} to ${s.account_id}`).join(", ")}`.slice(0, 1000);
}

/** The wallet transaction that files the proposal, with the bond the DAO's policy asks for. */
export function proposeTx(dao: string, router: string, shares: Share[], bond: string) {
  return {
    receiverId: dao,
    actions: [
      {
        type: "FunctionCall",
        params: { methodName: "add_proposal", args: { proposal: { description: describeShares(shares), kind: setSplitKind(router, shares) } }, gas: (50n * TGAS).toString(), deposit: bond },
      } satisfies FunctionCallAction,
    ],
  };
}

/** A council member's vote. Sputnik 3.x checks the kind, so a proposal swapped in under the same id fails. */
export function voteTx(dao: string, p: Pick<Proposal, "id" | "kind">, approve: boolean) {
  return {
    receiverId: dao,
    actions: [
      {
        type: "FunctionCall",
        params: { methodName: "act_proposal", args: { id: p.id, action: approve ? "VoteApprove" : "VoteReject", proposal: p.kind }, gas: (200n * TGAS).toString(), deposit: "0" },
      } satisfies FunctionCallAction,
    ],
  };
}

/** The wallet transaction that founds a group: a new DAO whose council is `members`. */
export function createDaoTx(factory: string, name: string, purpose: string, members: string[]) {
  const args = { config: { name, purpose, metadata: "" }, policy: members };
  return {
    receiverId: factory,
    actions: [
      { type: "FunctionCall", params: { methodName: "create", args: { name, args: b64(JSON.stringify(args)) }, gas: (150n * TGAS).toString(), deposit: DAO_CREATE_DEPOSIT.toString() } } satisfies FunctionCallAction,
    ],
  };
}

/** A DAO name the factory accepts: lowercase letters, digits, - and _, 2 to 32 characters. */
export function isDaoName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,31}$/.test(name);
}
