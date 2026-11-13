/**
 * "Auto-split my income": a standing instruction in plain words becomes a saved split the person
 * reviews and signs with set_split. From then on the router divides every payment sent to them.
 *
 * Safety rules, enforced here and tested in instruction.test.ts, whoever produced the draft
 * (the rule parser below or an AI model):
 * 1. Code, not the model, computes the numbers that get signed: basis points and the rest.
 * 2. An account can only appear if the person typed it, or it is their own signed-in account.
 * 3. A percentage or amount can only appear if the person typed it: as digits, in words
 *    ("thirty"), or for a percentage as an exact fraction ("a fifth" is 20, "half" is 50).
 * 4. Nothing here signs. The output is a draft shown for review; only the wallet signs.
 */

import { BPS_TOTAL, isAccountId, MAX_LEGS, normaliseAccount, parseCents, type Line } from "./payment";

export type Share = { account_id: string; bps: number; purpose: string };
export type ShareDraft = { shares: Share[]; notes: string[] };

/** What a model may propose for an instruction. Everything is re-checked by guardShares. */
export type ProposedShares = {
  parts: { account: string; percent: string; purpose: string | null }[];
  /** Where the remainder goes: to the person, or to one account they typed. Code computes it. */
  rest: { to_me: boolean; account?: string | null; purpose: string | null } | null;
  notes: string[];
};

const ACCOUNT_IN_TEXT = /@?[a-z\d][a-z\d\-_]*(?:\.[a-z\d][a-z\d\-_]*)+/gi;

/** "my tax pocket" and "my savings pocket" are the person's own pockets: tax.<me> and savings.<me>. */
export function expandPockets(text: string, me: string): string {
  return text.replace(/\bmy (tax|savings) pocket\b/gi, (_, p: string) => `${p.toLowerCase()}.${me}`);
}

const EMAIL_IN_TEXT = /[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+/gi;

/** Every email the person typed, lower case. People can be paid by email; the app finds their account. */
export function emailsIn(text: string): Set<string> {
  return new Set([...text.matchAll(EMAIL_IN_TEXT)].map((m) => m[0].toLowerCase()));
}

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

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Whole numbers written in words: "thirty", "twenty-five", "one hundred". */
export function wordNumbersIn(text: string): Set<string> {
  const found = new Set<string>();
  let current: number | null = null;
  const flush = () => {
    if (current !== null) found.add(String(current));
    current = null;
  };
  for (const tok of text.toLowerCase().split(/[^a-z]+/)) {
    if (tok in UNITS) {
      const u = UNITS[tok]!;
      if (current !== null && current >= 20 && current % 10 === 0 && current < 100 && u < 10) current += u;
      else if (current !== null && current >= 100 && current % 100 === 0) current += u;
      else {
        flush();
        current = u;
      }
    } else if (tok in TENS) {
      if (current !== null && current >= 100 && current % 100 === 0) current += TENS[tok]!;
      else {
        flush();
        current = TENS[tok]!;
      }
    } else if (tok === "hundred") {
      current = (current ?? 1) * 100;
    } else if (tok === "and" && current !== null && current >= 100) {
      // "one hundred and five"
    } else flush();
  }
  flush();
  return found;
}

const DENOMINATORS: Record<string, number> = {
  half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4, fourth: 4, fourths: 4, fifth: 5, fifths: 5,
  sixth: 6, sixths: 6, eighth: 8, eighths: 8, tenth: 10, tenths: 10, twentieth: 20, twentieths: 20,
};
const FRACTION = new RegExp(
  `\\b(?:(a|an|one|two|three|four|five|six|seven|eight|nine|\\d+)[\\s-]+)?(${Object.keys(DENOMINATORS).join("|")})\\b`,
  "gi",
);

/**
 * Percentages written as fractions: "a fifth" is 20, "three quarters" is 75, "half" is 50.
 * Only exact ones count (a third is 33.333…, so it is not accepted and the person types it).
 */
export function fractionPercentsIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(FRACTION)) {
    const word = m[1]?.toLowerCase();
    const den = DENOMINATORS[m[2]!.toLowerCase()]!;
    // Without a count only "half" reads as a fraction; "the fifth" is more likely a date.
    if (!word && den !== 2) continue;
    const num = !word || word === "a" || word === "an" ? 1 : /^\d+$/.test(word) ? Number(word) : UNITS[word]!;
    const hundredths = (num * 10_000) / den;
    if (!Number.isInteger(hundredths) || num > den) continue;
    found.add(canonicalNumber((hundredths / 100).toFixed(2)));
  }
  return found;
}

/** Every percentage the person wrote, in digits, words or exact fractions. */
function percentsIn(text: string): Set<string> {
  return new Set([...numbersIn(text), ...wordNumbersIn(text), ...fractionPercentsIn(text)]);
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
  const typedPercents = percentsIn(input);
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
    if (!typedPercents.has(canonicalNumber(pct))) {
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
  // "whatever is left goes to mum.ada.testnet": the remainder to one account the person typed.
  const restAccount = proposed.rest?.account ? normaliseAccount(proposed.rest.account) : null;
  if (rest > 0 && restAccount && restAccount !== me) {
    if (!isAccountId(restAccount) || !typedAccounts.has(restAccount)) {
      notes.push(`${restAccount} wasn't in what you wrote, so the rest stays with you`);
    } else {
      const existing = shares.find((s) => s.account_id === restAccount);
      if (existing) existing.bps += rest;
      else shares.push({ account_id: restAccount, bps: rest, purpose: cleanPurpose(proposed.rest?.purpose, "the rest") });
      if (shares.length > MAX_LEGS) return { shares: [], notes: [...notes, `A split can have at most ${MAX_LEGS} parts`] };
      return { shares, notes };
    }
  }
  if (rest > 0) {
    const mine = shares.find((s) => s.account_id === me);
    if (proposed.rest?.to_me || proposed.rest?.account || shares.length === 0) {
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
      // "the rest to savings.ada.testnet" sends the remainder there; code computes it.
      const toMe = !account || account === me;
      rest = { to_me: toMe, account: toMe ? null : account, purpose: purpose ?? (/(spend|spending)/i.test(clause) ? "spending" : null) };
    } else if (pct && !account) {
      notes.push(`"${clause}" has no NEAR account to pay`);
    } else if (account && !pct) {
      notes.push(`"${clause}" has no percentage`);
    }
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
  const typedEmails = emailsIn(input);
  const typedNumbers = numbersIn(input);
  const notes = proposed.notes.map((n) => n.slice(0, 200)).slice(0, 20);
  const lines: Line[] = [];
  for (const l of proposed.lines.slice(0, MAX_LEGS * 2)) {
    const email = l.who.trim().toLowerCase();
    const byEmail = typedEmails.has(email);
    const account = byEmail ? email : normaliseAccount(l.who);
    if (!byEmail && (!isAccountId(account) || !typedAccounts.has(account))) {
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
    // An email first: its domain would otherwise read as an account name.
    const email = [...line.matchAll(EMAIL_IN_TEXT)][0]?.[0];
    const account = email ?? [...line.matchAll(ACCOUNT_IN_TEXT)].map((m) => m[0]).find((a) => isAccountId(normaliseAccount(a)));
    if (!account) {
      proposed.notes.push(`"${line.slice(0, 60)}" has no email or Splits account`);
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
