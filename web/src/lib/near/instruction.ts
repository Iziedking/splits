/**
 * "Auto-split my income": a standing instruction in plain words becomes a saved split the person
 * reviews and signs with set_split. From then on the router divides every payment sent to them.
 *
 * Safety rules, enforced here and tested in instruction.test.ts, whoever produced the draft
 * (the rule parser below or an AI model):
 * 1. Code, not the model, computes the numbers that get signed: basis points and the rest.
 * 2. An account can only appear if the person typed it, or it is their own signed-in account.
 * 3. A percentage or amount can only appear if the person typed it.
 * 4. Nothing here signs. The output is a draft shown for review; only the wallet signs.
 */

import { BPS_TOTAL, isAccountId, MAX_LEGS, normaliseAccount, parseCents, type Line } from "./payment";

export type Share = { account_id: string; bps: number; purpose: string };
export type ShareDraft = { shares: Share[]; notes: string[] };

/** What a model may propose for an instruction. Everything is re-checked by guardShares. */
export type ProposedShares = {
  parts: { account: string; percent: string; purpose: string | null }[];
  rest: { to_me: boolean; purpose: string | null } | null;
  notes: string[];
};

const ACCOUNT_IN_TEXT = /@?[a-z\d][a-z\d\-_]*(?:\.[a-z\d][a-z\d\-_]*)+/gi;

/** Every account name the person typed, normalised. */
export function accountsIn(text: string): Set<string> {
  return new Set([...text.matchAll(ACCOUNT_IN_TEXT)].map((m) => normaliseAccount(m[0])).filter(isAccountId));
}

/** Every number the person typed, as written without separators ("1,250.50" -> "1250.50"). */
function numbersIn(text: string): Set<string> {
  return new Set([...text.replace(/(\d),(\d{3})/g, "$1$2").matchAll(/\d+(?:\.\d+)?/g)].map((m) => canonicalNumber(m[0])));
}

function canonicalNumber(n: string): string {
  const [w = "0", f = ""] = n.split(".");
  const frac = f.replace(/0+$/, "");
  return `${BigInt(w)}${frac ? `.${frac}` : ""}`;
}

/** "30" / "12.5" percent -> basis points. Null unless 0 < p ≤ 100 with at most two decimals. */
export function percentToBps(p: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(p.trim().replace(/%$/, ""));
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bps > 0 && bps <= BPS_TOTAL ? bps : null;
}

const cleanPurpose = (p: string | null | undefined, fallback: string) => {
  const t = (p ?? "").replace(/[.;,]+$/, "").trim();
  return (t || fallback).slice(0, 140);
};

/**
 * The only door into a saved split. Drops anything the person did not type, computes the rest,
 * and says why in notes.
 */
export function guardShares(input: string, me: string, proposed: ProposedShares): ShareDraft {
  const typedAccounts = accountsIn(input);
  const typedNumbers = numbersIn(input);
  const notes = proposed.notes.map((n) => n.slice(0, 200)).slice(0, 10);
  const shares: Share[] = [];
  for (const part of proposed.parts) {
    const account = normaliseAccount(part.account);
    if (!isAccountId(account)) {
      notes.push(`"${part.account}" isn't a NEAR account, so it was left out`);
      continue;
    }
    if (account !== me && !typedAccounts.has(account)) {
      notes.push(`${account} wasn't in what you wrote, so it was left out`);
      continue;
    }
    const pct = part.percent.trim().replace(/%$/, "");
    if (!/^\d+(?:\.\d+)?$/.test(pct)) {
      notes.push(`"${pct}" for ${account} isn't a number, so it was left out`);
      continue;
    }
    if (!typedNumbers.has(canonicalNumber(pct))) {
      notes.push(`${pct}% for ${account} wasn't in what you wrote, so it was left out`);
      continue;
    }
    const bps = percentToBps(pct);
    if (bps === null) {
      notes.push(`${pct}% for ${account} isn't a percentage between 0 and 100`);
      continue;
    }
    if (shares.some((s) => s.account_id === account)) {
      notes.push(`${account} appears twice; only the first was kept`);
      continue;
    }
    shares.push({ account_id: account, bps, purpose: cleanPurpose(part.purpose, "share") });
  }

  const used = shares.reduce((a, s) => a + s.bps, 0);
  if (used > BPS_TOTAL) return { shares: [], notes: [...notes, "The percentages add up to more than 100%"] };
  const rest = BPS_TOTAL - used;
  if (rest > 0) {
    const mine = shares.find((s) => s.account_id === me);
    if (proposed.rest?.to_me || shares.length === 0) {
      if (mine) mine.bps += rest;
      else shares.push({ account_id: me, bps: rest, purpose: cleanPurpose(proposed.rest?.purpose, "spending") });
    } else {
      notes.push(`${(rest / 100).toString()}% isn't given to anyone yet. Say where the rest goes, or it stays with you.`);
      if (mine) mine.bps += rest;
      else shares.push({ account_id: me, bps: rest, purpose: "spending" });
    }
  }
  if (shares.length > MAX_LEGS) return { shares: [], notes: [...notes, `A split can have at most ${MAX_LEGS} parts`] };
  return { shares, notes };
}

const REST = /\b(the\s+)?rest\b|\bremainder\b|\bkeep\b|\bstays?\b/i;

/**
 * Rule parser for instructions written the expected way. Used without an AI model, and as the
 * first try with one. Clauses are separated by commas, semicolons, "and" or new lines.
 */
export function parseInstruction(input: string, me: string): ShareDraft {
  const clauses = input
    .split(/[,;\n]|\band\b(?=\s*(?:\d|the\s+rest|rest))/i)
    .map((c) => c.trim())
    .filter(Boolean);
  const parts: ProposedShares["parts"] = [];
  let rest: ProposedShares["rest"] = null;
  const notes: string[] = [];
  for (const clause of clauses) {
    const pct = /(\d{1,3}(?:\.\d{1,2})?)\s*%|(\d{1,3}(?:\.\d{1,2})?)\s*percent/i.exec(clause);
    const account = [...clause.matchAll(ACCOUNT_IN_TEXT)].map((m) => normaliseAccount(m[0])).find(isAccountId);
    const purpose = /\bfor\s+(.+)$/i.exec(clause)?.[1] ?? null;
    if (pct && account) {
      parts.push({ account, percent: pct[1] ?? pct[2]!, purpose });
    } else if (REST.test(clause)) {
      rest = { to_me: !account || account === me, purpose: purpose ?? (/(spend|spending)/i.test(clause) ? "spending" : null) };
      if (account && account !== me) {
        // "the rest to savings.ada.testnet" is a real part with the remainder.
        parts.push({ account, percent: "0", purpose });
      }
    } else if (pct && !account) {
      notes.push(`"${clause}" has no NEAR account to pay`);
    } else if (account && !pct) {
      notes.push(`"${clause}" has no percentage`);
    }
  }
  // A "rest to <account>" part has no typed percentage; give it the remainder here, in code.
  const restTo = parts.find((p) => p.percent === "0");
  if (restTo) {
    const others = parts.filter((p) => p !== restTo);
    const used = others.reduce((a, p) => a + (percentToBps(p.percent) ?? 0), 0);
    const draft = guardShares(input, me, { parts: others, rest: { to_me: true, purpose: null }, notes });
    if (used < BPS_TOTAL) {
      const mine = draft.shares.find((s) => s.account_id === me);
      const restBps = BPS_TOTAL - used;
      if (mine && mine.bps === restBps && accountsIn(input).has(restTo.account)) {
        mine.account_id = restTo.account;
        mine.purpose = cleanPurpose(restTo.purpose, "the rest");
      }
    }
    return draft;
  }
  return guardShares(input, me, { parts, rest, notes });
}

// ------------------------------------------------------------------ describe it, I split it

export type ProposedLines = { lines: { who: string; amount: string | null; purpose: string | null }[]; notes: string[] };

/**
 * The same rules for a one-off list: only accounts and amounts the person typed survive. Amounts
 * left empty are for an equal split, which code computes.
 */
export function guardLines(input: string, me: string | null, proposed: ProposedLines): { lines: Line[]; notes: string[] } {
  const typedAccounts = accountsIn(input);
  const typedNumbers = numbersIn(input);
  const notes = proposed.notes.map((n) => n.slice(0, 200)).slice(0, 20);
  const lines: Line[] = [];
  for (const l of proposed.lines.slice(0, MAX_LEGS * 2)) {
    const account = normaliseAccount(l.who);
    if (!isAccountId(account) || !typedAccounts.has(account)) {
      notes.push(`${l.who || "A line"} wasn't a NEAR account in what you wrote, so it was left out`);
      continue;
    }
    if (me && account === me) continue;
    let amount = "";
    if (l.amount) {
      const cents = parseCents(l.amount);
      const plain = l.amount.replace(/usdc|usd|\$|,|\s/gi, "");
      if (cents === null || !typedNumbers.has(canonicalNumber(plain))) {
        notes.push(`The amount for ${account} wasn't in what you wrote; enter it yourself`);
      } else amount = plain;
    }
    lines.push({ account, amount, purpose: (l.purpose ?? "").trim().slice(0, 140) });
  }
  return { lines, notes };
}

/** Rule parser for "ada.testnet, 50, rent" lines. */
export function parseLines(input: string, me: string | null): { lines: Line[]; notes: string[] } {
  const proposed: ProposedLines = { lines: [], notes: [] };
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const account = [...line.matchAll(ACCOUNT_IN_TEXT)].map((m) => m[0]).find((a) => isAccountId(normaliseAccount(a)));
    if (!account) {
      proposed.notes.push(`"${line.slice(0, 60)}" has no NEAR account`);
      continue;
    }
    const rest = line.replace(account, " ");
    const amount = /\$?\s*(\d[\d,]*(?:\.\d{1,2})?)/.exec(rest)?.[1] ?? null;
    const purpose = rest
      .replace(/\$?\s*\d[\d,]*(?:\.\d{1,2})?\s*(usdc|usd)?/i, " ")
      .replace(/^[\s,:\-–]+|[\s,]+$/g, "")
      .replace(/^for\s+/i, "")
      .replace(/\s{2,}/g, " ");
    proposed.lines.push({ who: account, amount, purpose: purpose || null });
  }
  return guardLines(input, me, proposed);
}
