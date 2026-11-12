/**
 * Payroll in and records out. A CSV of people, amounts and purposes becomes payment lines (checked
 * afterwards by checkList, like a typed list), and a finished payment becomes a CSV an accountant
 * can open: one row per person, with the transaction on NEAR.
 */

import { formatUnits, MAX_LEGS, type LegResult, type Line } from "./payment";

/** The template offered for download. */
export const PAYROLL_TEMPLATE = "account,amount,purpose\nada.testnet,1200.00,salary\ntax.acme.testnet,300.00,payroll tax\n";

/** One CSV record per line, RFC 4180 quoting, comma or semicolon separated. */
export function parseRecords(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ""));
}

const HEADERS = {
  account: /^(account|account id|near account|to|recipient|who|name)$/i,
  amount: /^(amount|pay|salary|usdc|value|sum)$/i,
  purpose: /^(purpose|for|memo|note|description|reason)$/i,
};

/**
 * People, amounts and purposes from a payroll CSV. A header row is optional: without one the
 * columns are account, amount, purpose. Problems are reported by row number, as a spreadsheet shows it.
 */
export function parsePayrollCsv(text: string): { lines: Line[]; problems: string[] } {
  const rows = parseRecords(text);
  const problems: string[] = [];
  if (rows.length === 0) return { lines: [], problems: ["The file is empty"] };
  const head = rows[0]!;
  const col = { account: 0, amount: 1, purpose: 2 };
  let start = 0;
  if (head.some((h) => HEADERS.account.test(h) || HEADERS.amount.test(h))) {
    start = 1;
    for (const key of ["account", "amount", "purpose"] as const) {
      const i = head.findIndex((h) => HEADERS[key].test(h));
      if (i >= 0) col[key] = i;
      else if (key !== "purpose") problems.push(`The header has no ${key} column`);
    }
    if (!head.some((h) => HEADERS.purpose.test(h))) col.purpose = -1;
  }
  if (problems.length) return { lines: [], problems };
  const lines: Line[] = [];
  rows.slice(start).forEach((r, i) => {
    const rowNo = i + start + 1;
    const account = (r[col.account] ?? "").trim();
    const amount = (r[col.amount] ?? "").replace(/^\$\s*|\s*usdc$/gi, "").trim();
    if (!account || !amount) {
      problems.push(`Row ${rowNo} needs an account and an amount`);
      return;
    }
    lines.push({ account, amount, purpose: col.purpose >= 0 ? (r[col.purpose] ?? "").trim() : "" });
  });
  return { lines, problems };
}

/** A payment holds at most MAX_LEGS people, so a longer payroll is paid in batches. */
export function batches<T>(items: T[], size = MAX_LEGS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Quote a field when it needs it, and defuse cells a spreadsheet would run as a formula. */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** The record of one finished payment: a row per person, as the router reported it. */
export function paymentCsv(p: { legs: LegResult[]; payer: string; ref: string; tx: string; token: string; symbol: string; network: string; explorerTx: string; at: Date }): string {
  const date = p.at.toISOString();
  return toCsv([
    ["date_utc", "network", "payer", "recipient", "purpose", "amount", "token", "status", "reference", "transaction", "explorer"],
    // Amounts without thousands separators, so a spreadsheet reads them as numbers.
    ...p.legs.map((l) => [date, `NEAR ${p.network}`, p.payer, l.account_id, l.purpose, formatUnits(BigInt(l.amount)).replace(/,/g, ""), p.symbol, l.landed ? "paid" : "returned to payer", p.ref, p.tx, p.explorerTx]),
  ]);
}
