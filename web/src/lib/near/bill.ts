/**
 * Split a bill: one friend paid for dinner, everyone else pays back their part. The friend who paid
 * sets the bill up once (what it was, the total, who was there and what each owes) and shares a
 * link. Each friend opens it, connects the wallet listed next to their name, and pays their part
 * straight to the friend who paid, in one approval.
 *
 * Nothing is stored here. The bill rides in the link, and who has paid is read from the router
 * itself: every part is paid with its own reference, and the router records each (payer, reference)
 * it has accepted, so `is_ref_used(friend, reference)` says whether that friend has paid.
 */
import { CENT, MAX_PURPOSE_BYTES, equalCents, formatUnits, isAccountId, normaliseAccount, parseCents, type Leg } from "./payment";
import { fromB64Url, toB64Url } from "./button";

export type BillPerson = { name: string; account: string; amount: bigint };
export type Bill = {
  /** Random, so two bills with the same people never share references. */
  id: string;
  /** What it was, like "Dinner at Yellow Chilli". */
  title: string;
  /** The friend who paid, and who gets paid back. */
  host: string;
  hostName: string;
  /** The whole bill, the host's own part included, in USDC units. */
  total: bigint;
  /** Everyone who owes the host, with what they owe. */
  people: BillPerson[];
};

export const MAX_PEOPLE = 20;
export const MAX_TITLE = 60;
export const MAX_NAME = 30;
export const MAX_BILL_UNITS = 100_000n * CENT; // 1,000.00

/** A new bill id: 8 characters, enough that two bills never collide in practice. */
export function newBillId(random: () => number = Math.random): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

/** The reference a person's part is paid with; the router accepts each one once per payer. */
export const billRef = (b: Bill, index: number) => `bill-${b.id}-${index + 1}`;

/** The host's own part: what is left of the bill once everyone else has paid theirs. */
export const hostShare = (b: Bill) => b.total - b.people.reduce((a, p) => a + p.amount, 0n);

/**
 * Split `total` (USDC units, whole cents) equally between the host and `others` friends. Any odd
 * cent stays with the host, so friends all pay the same.
 */
export function equalParts(total: bigint, others: number): { host: bigint; each: bigint } {
  // The smallest equal part goes to every friend; the host keeps whatever cents are left over.
  const each = (equalCents(total / CENT, others + 1).at(-1) ?? 0n) * CENT;
  return { host: total - each * BigInt(others), each };
}

/** A tip on top of the bill, rounded down to whole cents. */
export function withTip(subtotal: bigint, tipPercent: number): bigint {
  const tip = (subtotal * BigInt(Math.round(tipPercent * 100))) / 10_000n;
  return subtotal + (tip / CENT) * CENT;
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Everything wrong with a bill, in words the friend who paid can act on. Empty means it is ready. */
export function billProblems(b: Bill): string[] {
  const out: string[] = [];
  if (!b.title.trim()) out.push("Say what the bill was for, like “Dinner at Yellow Chilli”.");
  if (b.title.length > MAX_TITLE) out.push(`Keep what it was for under ${MAX_TITLE} characters.`);
  if (!isAccountId(b.host)) out.push("Connect the wallet that should get paid back.");
  if (!b.hostName.trim()) out.push("Add your name, so friends know who they are paying.");
  if (b.total < CENT || b.total > MAX_BILL_UNITS) out.push(`Enter a bill between 0.01 and ${formatUnits(MAX_BILL_UNITS)} USDC.`);
  if (b.people.length === 0) out.push("Add at least one friend who owes you.");
  if (b.people.length > MAX_PEOPLE) out.push(`At most ${MAX_PEOPLE} friends on one bill.`);
  const seen = new Set<string>();
  b.people.forEach((p, i) => {
    const who = p.name.trim() || `Friend ${i + 1}`;
    if (!p.name.trim()) out.push(`Friend ${i + 1}: add their name.`);
    else if (p.name.length > MAX_NAME) out.push(`${who}: keep the name under ${MAX_NAME} characters.`);
    if (!isAccountId(p.account)) out.push(`${who}: "${p.account || "(empty)"}" is not a NEAR account.`);
    else if (p.account === b.host) out.push(`${who}: that is your own wallet. Leave yourself off the list.`);
    else if (seen.has(p.account)) out.push(`${who}: ${p.account} is on the bill twice.`);
    seen.add(p.account);
    if (p.amount < CENT) out.push(`${who}: their part must be at least 0.01 USDC.`);
  });
  if (out.length === 0 && hostShare(b) < 0n) out.push(`The parts add up to more than the bill, by ${formatUnits(-hostShare(b))} USDC.`);
  return out;
}

/** The one part a friend pays: their amount, straight to the host, with what it was for. */
export function billLeg(b: Bill, index: number): Leg {
  const p = b.people[index]!;
  let purpose = `${b.title.trim()}: ${p.name.trim()}'s part`;
  while (bytes(purpose) > MAX_PURPOSE_BYTES) purpose = purpose.slice(0, -2) + "…";
  return { account_id: b.host, amount: p.amount.toString(), purpose };
}

// ------------------------------------------------------------------ the link

type Wire = { v: 1; i: string; t: string; h: string; n: string; a: string; p: [string, string, string][] };

export function encodeBill(b: Bill): string {
  const wire: Wire = {
    v: 1,
    i: b.id,
    t: b.title.trim(),
    h: normaliseAccount(b.host),
    n: b.hostName.trim(),
    a: formatUnits(b.total),
    p: b.people.map((p) => [p.name.trim(), normaliseAccount(p.account), formatUnits(p.amount)]),
  };
  return toB64Url(JSON.stringify(wire));
}

/** A bill from a link, or null when the link is damaged or the bill does not add up. */
export function decodeBill(code: string): Bill | null {
  if (!code || code.length > 6000 || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  try {
    const w = JSON.parse(fromB64Url(code)) as Wire;
    if (w.v !== 1 || typeof w.i !== "string" || !/^[a-z0-9]{4,16}$/.test(w.i) || !Array.isArray(w.p)) return null;
    const total = parseCents(String(w.a));
    if (total === null) return null;
    const people: BillPerson[] = [];
    for (const x of w.p) {
      const amount = parseCents(String(x[2]));
      if (amount === null) return null;
      people.push({ name: String(x[0]), account: String(x[1]), amount: amount * CENT });
    }
    const b: Bill = { id: w.i, title: String(w.t), host: String(w.h), hostName: String(w.n), total: total * CENT, people };
    return billProblems(b).length === 0 ? b : null;
  } catch {
    return null;
  }
}

export function billPath(b: Bill): string {
  return `/near/tab?b=${encodeBill(b)}`;
}
