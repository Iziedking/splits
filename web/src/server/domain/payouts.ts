import { getAddress, isAddress, type Address } from "viem";
import { CENT, SplitRuleError } from "./allocation";
import { isValidEmail } from "./email";
import { MoneyError, parseUsdc, purposeToBytes32 } from "./money";

/**
 * The most recipients one payment may ever have. The router has no limit; one transaction's gas
 * does. Measured on an Arc mainnet fork on 2026-10-11 (contracts/test/ArcFork.t.sol,
 * test_Fork_PayGasPerRecipient): GAS_PER_LEG=49160, BLOCK_GAS_LIMIT=30000000, so half a block
 * carries 305 recipients; this is that, rounded down to a multiple of 10. MAX_PAYOUT_RECIPIENTS
 * can be raised up to here without a redeploy.
 */
export const MAX_RECIPIENTS_CEILING = 300;

export type PayoutTarget = { type: "email"; email: string } | { type: "address"; address: Address };

export type ParsedLine = {
  /** 1-based line number in what the person pasted, so messages point at the right line. */
  line: number;
  raw: string;
  target: PayoutTarget | null;
  amount: bigint | null;
  label: string | null;
  problem: string | null;
};

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** All-lowercase and all-uppercase addresses carry no checksum; a mixed-case one must match its own. */
function checksumOk(address: string): boolean {
  const hex = address.slice(2);
  return hex === hex.toLowerCase() || hex === hex.toUpperCase() || isAddress(address, { strict: true });
}

export function recipientKey(t: PayoutTarget): string {
  return t.type === "email" ? `email:${t.email}` : `address:${t.address.toLowerCase()}`;
}

/**
 * One person per line: `address or email, amount?, label?`. Commas or tabs separate the fields, so
 * a range pasted from a spreadsheet works. Blank lines are skipped.
 */
export function parsePayoutLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const raw = rawLine.trim();
    if (!raw) return;
    const [who = "", amountText = "", ...rest] = raw.split(/[,\t]/).map((p) => p.trim());
    const labelText = rest.join(",").trim();
    const parsed: ParsedLine = { line: i + 1, raw, target: null, amount: null, label: null, problem: null };

    if (HEX_ADDRESS.test(who)) {
      if (checksumOk(who)) parsed.target = { type: "address", address: getAddress(who) };
      else parsed.problem = "This address has a typo. Copy it again from the source.";
    } else if (/^@[^@\s]+$/.test(who)) {
      parsed.problem = "Usernames are not supported yet. Use an email or wallet address.";
    } else if (who.includes("@")) {
      if (isValidEmail(who.toLowerCase())) parsed.target = { type: "email", email: who.toLowerCase() };
      else parsed.problem = "That email address isn't valid";
    } else {
      parsed.problem = "Not an email or an Arc address";
    }

    if (!parsed.problem && amountText) {
      try {
        const amount = parseUsdc(amountText);
        if (amount === 0n) parsed.problem = "Amount must be more than zero";
        else if (amount % CENT !== 0n) parsed.problem = "Use whole cents, like 25.50";
        else parsed.amount = amount;
      } catch {
        parsed.problem = "Amount isn't a number like 5 or 2.50";
      }
    }
    if (!parsed.problem && labelText) {
      try {
        purposeToBytes32(labelText);
        parsed.label = labelText;
      } catch (err) {
        parsed.problem = err instanceof MoneyError ? "Keep the label under 32 characters" : "Label isn't valid";
      }
    }
    out.push(parsed);
  });
  return out;
}

/**
 * Splits a pot between `count` people as evenly as whole cents allow: everyone gets the same
 * number of cents, and the leftover cents go one each to the first people in the list.
 */
export function equalPot(pot: bigint, count: number): bigint[] {
  if (count < 1) throw new SplitRuleError("NO_LEGS", "Add at least one recipient");
  if (pot % CENT !== 0n) throw new SplitRuleError("AMOUNT_NOT_CENTS", "Use whole cents for the pot, like 100.50");
  const cents = pot / CENT;
  const n = BigInt(count);
  if (cents < n) throw new SplitRuleError("AMOUNT_BELOW_FIXED", "The pot must give everyone at least one cent each");
  const base = cents / n;
  const extra = Number(cents % n);
  return Array.from({ length: count }, (_, i) => (base + (i < extra ? 1n : 0n)) * CENT);
}
