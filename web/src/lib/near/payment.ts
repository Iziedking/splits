/**
 * NEAR payments, pure logic. Mirrors near/splits-router/src/lib.rs: the limits, the division rule
 * and the event names must match it. Amounts the person types are in cents; the token works in
 * micro-units (6 decimals), so one cent is 10,000 units.
 */

export const CENT = 10_000n;
export const MAX_LEGS = 10;
/** The router refuses less than 10,000 units (one cent). */
export const MIN_TOTAL = CENT;
export const MAX_PURPOSE_BYTES = 140;
export const MAX_REF_BYTES = 64;
export const BPS_TOTAL = 10_000;

/** Gas the router needs: its own work, one transfer per part, and the callback. Mirrors lib.rs. */
export function gasFor(parts: number): bigint {
  const tgas = 15 + 10 * parts + 10 + 2 * parts + 30; // + the token's own ft_transfer_call and resolve
  return BigInt(Math.min(300, tgas)) * 10n ** 12n;
}

/** NEAR reserves gas × price up front. On testnet that is about 0.001 NEAR per TGas. */
export function nearNeededForGas(parts: number): bigint {
  return (gasFor(parts) / 10n ** 12n) * 10n ** 21n;
}

/** One unit of the token's storage deposit, from storage_balance_bounds on testnet USDC. */
export const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n;

// ------------------------------------------------------------------ accounts

const NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** A NEAR account id: 2 to 64 characters, lowercase letters, digits and - _ . between them. */
export function isAccountId(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && NAMED.test(id);
}

/** People type "Ada.testnet " or "@ada.testnet"; the account is "ada.testnet". */
export function normaliseAccount(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

// ------------------------------------------------------------------ money

/** "12.5" / "$1,250.50" -> cents. Null unless it is a positive amount in whole cents. */
export function parseCents(raw: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.replace(/usdc|usd|\$|,|\s/gi, ""));
  if (!m) return null;
  const cents = BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  return cents > 0n ? cents : null;
}

/** Micro-units -> "12.50", or "0.125" when the amount is not whole cents. */
export function formatUnits(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole.toLocaleString("en-US")}.${frac}`;
}

/** Micro-units of USDC as dollars, the way people read money: "$12.50". USDC is a digital dollar. */
export function formatDollars(units: bigint): string {
  return `$${formatUnits(units)}`;
}

export function formatNear(yocto: bigint): string {
  const milli = yocto / 10n ** 21n;
  return `${milli / 1000n}.${(milli % 1000n).toString().padStart(3, "0")}`;
}

/** Split `total` into `parts` whole cents, extra cents to the first parts (the Arc rule). */
export function equalCents(total: bigint, parts: number): bigint[] {
  if (parts <= 0) return [];
  const n = BigInt(parts);
  const base = total / n;
  const extra = total % n;
  return Array.from({ length: parts }, (_, i) => base + (BigInt(i) < extra ? 1n : 0n));
}

/** Same as the contract's divide_by_shares, in micro-units. */
export function divideByShares(amount: bigint, shares: { bps: number }[]): bigint[] {
  const parts = shares.map((s) => (amount * BigInt(s.bps)) / BigInt(BPS_TOTAL));
  let left = amount - parts.reduce((a, b) => a + b, 0n);
  for (let i = 0; i < parts.length && left > 0n; i++) {
    parts[i] = parts[i]! + 1n;
    left -= 1n;
  }
  return parts;
}

// ------------------------------------------------------------------ the list

export type Line = { account: string; amount: string; purpose: string };
export type Leg = { account_id: string; amount: string; purpose: string };
export type Problem = { line: number | null; message: string };

const bytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * Check a list before anyone signs. `mode` "equal" shares `pot` equally; "each" uses every line's
 * amount. Returns the exact parts in micro-units and the problems to show.
 */
export function checkList(
  lines: Line[],
  opts: { me: string | null; mode: "equal" | "each"; pot?: string },
): { legs: Leg[]; total: bigint; problems: Problem[] } {
  const problems: Problem[] = [];
  const filled = lines.filter((l) => l.account.trim() || l.amount.trim() || l.purpose.trim());
  if (filled.length === 0) problems.push({ line: null, message: "Add at least one person to pay" });
  if (filled.length > MAX_LEGS) problems.push({ line: null, message: `At most ${MAX_LEGS} people per payment. Send the rest as a second payment.` });

  let cents: bigint[] = [];
  if (opts.mode === "equal") {
    const pot = parseCents(opts.pot ?? "");
    if (pot === null) problems.push({ line: null, message: "Enter the total to share, like 300 or 12.50" });
    else if (filled.length > 0) {
      cents = equalCents(pot, filled.length);
      if (cents.some((c) => c === 0n)) problems.push({ line: null, message: "That total is too small to give everyone at least a cent" });
    }
  }

  const seen = new Map<string, number>();
  const legs: Leg[] = [];
  filled.forEach((l, i) => {
    const n = i + 1;
    const account = normaliseAccount(l.account);
    if (!account) problems.push({ line: n, message: "Who gets this? Add their NEAR account, like ada.testnet" });
    else if (!isAccountId(account)) problems.push({ line: n, message: `"${l.account.trim()}" isn't a NEAR account name` });
    else if (opts.me && account === opts.me) problems.push({ line: n, message: "That's your own account" });
    else if (seen.has(account)) problems.push({ line: n, message: `${account} is already on line ${seen.get(account)}` });
    if (account) seen.set(account, seen.get(account) ?? n);

    const purpose = l.purpose.trim();
    if (!purpose) problems.push({ line: n, message: "Say what this part is for" });
    else if (bytes(purpose) > MAX_PURPOSE_BYTES) problems.push({ line: n, message: "Keep the purpose under 140 characters" });

    let c: bigint | null;
    if (opts.mode === "equal") c = cents[i] ?? null;
    else {
      c = parseCents(l.amount);
      if (c === null) problems.push({ line: n, message: "Enter an amount like 75 or 12.50" });
    }
    if (c !== null) legs.push({ account_id: account, amount: (c * CENT).toString(), purpose });
  });

  const total = legs.reduce((a, l) => a + BigInt(l.amount), 0n);
  if (problems.length === 0 && total < MIN_TOTAL) problems.push({ line: null, message: "The smallest payment is 0.01" });
  return { legs: problems.length ? [] : legs, total, problems };
}

// ------------------------------------------------------------------ the transaction

/** A short unique reference. The router refuses a reference the same payer already used. */
export function newRef(random: () => number = Math.random): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let out = "sp-";
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

const TGAS = 10n ** 12n;
const MAX_TX_GAS = 300n * TGAS;
const REGISTER_GAS = 10n * TGAS;
const bigMin = (a: bigint, b: bigint) => (a < b ? a : b);

export type FunctionCallAction = {
  type: "FunctionCall";
  params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
};
export type WalletTx = { receiverId: string; actions: FunctionCallAction[] };

/**
 * One transaction to the token, one approval: register anyone who is not registered yet (the payer
 * pays their storage deposit), then send the total to the router with the split in `msg`.
 */
export function buildPayTx(opts: {
  token: string;
  router: string;
  total: bigint;
  msg: Record<string, unknown>;
  parts: number;
  unregistered: string[];
}): WalletTx {
  const register: FunctionCallAction[] = opts.unregistered.map((account_id) => ({
    type: "FunctionCall",
    params: {
      methodName: "storage_deposit",
      args: { account_id, registration_only: true },
      gas: REGISTER_GAS.toString(),
      deposit: STORAGE_DEPOSIT.toString(),
    },
  }));
  return {
    receiverId: opts.token,
    actions: [
      ...register,
      {
        type: "FunctionCall",
        params: {
          methodName: "ft_transfer_call",
          args: { receiver_id: opts.router, amount: opts.total.toString(), msg: JSON.stringify(opts.msg) },
          // A transaction carries 300 TGas at most, registrations included.
          gas: bigMin(gasFor(opts.parts), MAX_TX_GAS - REGISTER_GAS * BigInt(opts.unregistered.length)).toString(),
          deposit: "1",
        },
      },
    ],
  };
}

/** Total gas of a transaction, which must stay at or under 300 TGas. */
export function txGas(tx: WalletTx): bigint {
  return tx.actions.reduce((a, x) => a + BigInt(x.params.gas), 0n);
}

// ------------------------------------------------------------------ reading the result

export type SplitsEvent = { event: string; data: Record<string, unknown> };

type Outcome = {
  status?: unknown;
  receipts_outcome?: { outcome: { logs: string[]; executor_id?: string } }[];
  transaction?: { hash?: string; signer_id?: string };
};

/** Every `splits` event the router logged in a final transaction outcome. */
export function splitsEvents(outcome: Outcome, router: string): SplitsEvent[] {
  const out: SplitsEvent[] = [];
  for (const r of outcome.receipts_outcome ?? []) {
    if (r.outcome.executor_id && r.outcome.executor_id !== router) continue;
    for (const log of r.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        const body = JSON.parse(log.slice("EVENT_JSON:".length));
        if (body.standard !== "splits") continue;
        for (const data of body.data ?? []) out.push({ event: String(body.event), data });
      } catch {
        // A log that isn't JSON is not an event.
      }
    }
  }
  return out;
}

export type LegResult = Leg & { landed: boolean };
export type Verdict =
  | { kind: "landed"; legs: LegResult[]; paid: bigint }
  | { kind: "partly"; legs: LegResult[]; paid: bigint; refunded: bigint }
  | { kind: "refused"; reason: string }
  | { kind: "mismatch"; detail: string }
  | { kind: "unknown"; detail: string };

/**
 * Compare what the chain says happened with what the payer approved. "Landed" is shown only when
 * every approved part is in the router's `payment` event, with the same account, amount and
 * purpose, and marked landed.
 */
export function verifyPayment(events: SplitsEvent[], expected: { payer: string; ref: string; legs: Leg[] | null }): Verdict {
  const refused = events.find((e) => e.event === "payment_refused");
  if (refused) return { kind: "refused", reason: String(refused.data.reason ?? "unknown") };
  const payment = events.find((e) => e.event === "payment" && e.data.ref === expected.ref && e.data.payer === expected.payer);
  if (!payment) return { kind: "unknown", detail: "The router did not record this payment" };
  const legs = (payment.data.legs as { recipient: string; amount: string; purpose: string; landed: boolean }[] | undefined) ?? [];
  const results: LegResult[] = legs.map((l) => ({ account_id: l.recipient, amount: l.amount, purpose: l.purpose, landed: Boolean(l.landed) }));
  if (expected.legs) {
    if (expected.legs.length !== results.length) return { kind: "mismatch", detail: "A different number of parts was paid" };
    for (let i = 0; i < expected.legs.length; i++) {
      const a = expected.legs[i]!;
      const b = results[i]!;
      if (a.account_id !== b.account_id || a.amount !== b.amount || a.purpose !== b.purpose) {
        return { kind: "mismatch", detail: `Part ${i + 1} on chain is not the part you approved` };
      }
    }
  }
  const paid = results.filter((l) => l.landed).reduce((a, l) => a + BigInt(l.amount), 0n);
  const refunded = results.filter((l) => !l.landed).reduce((a, l) => a + BigInt(l.amount), 0n);
  return refunded === 0n ? { kind: "landed", legs: results, paid } : { kind: "partly", legs: results, paid, refunded };
}

/** Plain words for the router's refusal codes. */
export function refusalText(reason: string): string {
  const map: Record<string, string> = {
    ref_already_used: "This payment was already sent once, so nothing was sent again.",
    legs_do_not_add_up: "The parts did not add up to the total.",
    stale_split_version: "Their split changed while you were paying. Check the new split and pay again.",
    no_saved_split: "That account has no saved split.",
    token_not_allowed: "The router does not accept that token.",
    amount_too_small: "The smallest payment is 0.01.",
    not_enough_gas: "The wallet did not attach enough gas.",
    duplicate_recipient: "Someone appears twice.",
  };
  return map[reason] ?? `The router refused the payment (${reason}).`;
}
