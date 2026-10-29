import { z } from "zod";

/**
 * What the model may return: the only channel it has. Anything else it sends is stripped by the
 * schema, so pasted instructions can at most produce lines the person sees and checks.
 */
export const agentDraftSchema = z.object({
  split: z.enum(["equal", "each"]).describe('"equal" when a total is shared equally (put it in pot), otherwise "each"'),
  pot: z.string().nullable().describe("The total to share equally, as a plain number like 300, or null"),
  label: z.string().nullable().describe("A short reason for the whole payment, at most 31 characters, or null"),
  lines: z
    .array(
      z.object({
        who: z.string().describe("Exactly one email, one 0x wallet address copied character for character, or an @username"),
        amount: z.string().nullable().describe('For "each": a plain number like 75 or 12.50; null for "equal"'),
        purpose: z.string().nullable().describe("A short reason for this person, or null"),
      }),
    )
    .max(500),
  notes: z
    .array(
      z.object({
        line: z.number().int().nullable().describe("The 1-based position in lines this note is about, or null"),
        text: z.string().describe("What was uncertain, without repeating the line number"),
      }),
    ),
});
export type AgentDraft = z.infer<typeof agentDraftSchema>;

/** Exactly what the payout composer holds. */
export type ComposerFill = { mode: "equal" | "each"; text: string; pot: string; label: string; notes: string[] };

export class NothingFound extends Error {}

const LABEL_BYTES = 31;
const NOTE_CHARS = 200;
const MAX_NOTES = 20;

/** "$1,250.5 USDC" -> "1250.50". Null unless it is a positive amount in whole cents. */
export function cleanAmount(raw: string): string | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(raw.replace(/usdc|usd|\$|,|\s/gi, ""));
  if (!m) return null;
  const whole = m[1]!.replace(/^0+(?=\d)/, "");
  const fraction = m[2] ?? "";
  if (/[1-9]/.test(fraction.slice(2))) return null;
  const cents = fraction.slice(0, 2).padEnd(2, "0");
  if (whole === "0" && cents === "00") return null;
  return `${whole}.${cents}`;
}

/** At most `max` UTF-8 bytes, never splitting a character. */
export function cutBytes(s: string, max = LABEL_BYTES): string {
  const encoder = new TextEncoder();
  let out = "";
  for (const ch of s) {
    if (encoder.encode(out + ch).length > max) break;
    out += ch;
  }
  return out;
}

/** One composer field: no separators inside it, single spaces. */
const field = (s: string) => s.replace(/[,\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();

/** Cleans a draft into composer text, one `who, amount, purpose` line per person, with notes. */
export function toComposer(draft: AgentDraft, maxLines: number): ComposerFill {
  const notes: string[] = [];
  const lineNo = new Map<number, number>(); // the model's 1-based line -> the composer's
  const out: string[] = [];
  let people = 0;

  draft.lines.forEach((l, i) => {
    const who = field(l.who);
    if (!who) return;
    people++;
    if (out.length >= maxLines) return;
    const n = out.length + 1;
    lineNo.set(i + 1, n);
    let amount = "";
    if (draft.split === "each" && l.amount !== null) {
      const cleaned = cleanAmount(l.amount);
      if (cleaned) amount = cleaned;
      else notes.push(`Line ${n}: "${field(l.amount)}" isn't an amount in whole cents, so it was left out`);
    }
    let purpose = field(l.purpose ?? "");
    if (cutBytes(purpose) !== purpose) {
      purpose = cutBytes(purpose).trim();
      notes.push(`Line ${n}: the label was shortened to fit 31 characters`);
    }
    // Screenshots of social posts are full of @handles; a Splits tag with the same letters may be someone else.
    if (/^[@＠]/.test(who)) notes.push(`Line ${n}: ${who} will be paid as the Splits account ${who}, not a social media handle`);
    out.push(purpose ? `${who}, ${amount}, ${purpose}` : amount ? `${who}, ${amount}` : who);
  });
  if (out.length === 0) throw new NothingFound("Nobody to pay");
  // First, so the cap on notes can never hide that people were left out.
  if (people > maxLines) notes.unshift(`Only the first ${maxLines} fit in one payment`);

  let pot = "";
  if (draft.split === "equal" && draft.pot !== null) {
    pot = cleanAmount(draft.pot) ?? "";
    if (!pot) notes.push(`"${field(draft.pot)}" isn't an amount in whole cents, so add the pot yourself`);
  }
  let label = field(draft.label ?? "");
  if (cutBytes(label) !== label) {
    label = cutBytes(label).trim();
    notes.push("The label for everyone was shortened to fit 31 characters");
  }

  for (const note of draft.notes) {
    const text = [...field(note.text)].slice(0, NOTE_CHARS).join("");
    if (!text) continue;
    if (note.line === null) notes.push(text);
    else if (lineNo.has(note.line)) notes.push(`Line ${lineNo.get(note.line)}: ${text}`);
  }
  return { mode: draft.split, text: out.join("\n"), pot, label, notes: notes.slice(0, MAX_NOTES) };
}
