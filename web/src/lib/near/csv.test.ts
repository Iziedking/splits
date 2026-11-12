import { describe, expect, it } from "vitest";
import { batches, csvField, parsePayrollCsv, parseRecords, paymentCsv, PAYROLL_TEMPLATE } from "./csv";

describe("parsePayrollCsv", () => {
  it("reads the template", () => {
    const r = parsePayrollCsv(PAYROLL_TEMPLATE);
    expect(r.problems).toEqual([]);
    expect(r.lines).toEqual([
      { account: "ada.testnet", amount: "1200.00", purpose: "salary" },
      { account: "tax.acme.testnet", amount: "300.00", purpose: "payroll tax" },
    ]);
  });

  it("finds columns by header in any order, with quotes, semicolons and a BOM", () => {
    const csv = '﻿For;Amount;Recipient\r\n"rent; March";"1,250.50";bo.testnet\r\n';
    expect(parsePayrollCsv(csv).lines).toEqual([{ account: "bo.testnet", amount: "1,250.50", purpose: "rent; March" }]);
  });

  it("works without a header and without a purpose column", () => {
    expect(parsePayrollCsv("ada.testnet,10\nbo.testnet,$5 USDC\n").lines).toEqual([
      { account: "ada.testnet", amount: "10", purpose: "" },
      { account: "bo.testnet", amount: "5", purpose: "" },
    ]);
  });

  it("names rows that are missing something, as a spreadsheet numbers them", () => {
    const r = parsePayrollCsv("account,amount\nada.testnet,10\nbo.testnet,\n");
    expect(r.problems).toEqual(["Row 3 needs an account and an amount"]);
    expect(r.lines).toHaveLength(1);
  });

  it("says when the header has no amount column", () => {
    expect(parsePayrollCsv("account,salaryy\nada.testnet,10\n").problems).toEqual(["The header has no amount column"]);
  });

  it("keeps doubled quotes inside a quoted field", () => {
    expect(parseRecords('a,"say ""hi"""\n')).toEqual([["a", 'say "hi"']]);
  });
});

describe("batches", () => {
  it("splits a long payroll into payments of ten", () => {
    expect(batches(Array.from({ length: 23 }, (_, i) => i)).map((b) => b.length)).toEqual([10, 10, 3]);
  });
});

describe("paymentCsv", () => {
  it("writes one row per person an accountant can open", () => {
    const csv = paymentCsv({
      legs: [
        { account_id: "ada.testnet", amount: "1200000000", purpose: "salary, March", landed: true },
        { account_id: "nobody.testnet", amount: "500000", purpose: "=HYPERLINK(1)", landed: false },
      ],
      payer: "acme.testnet",
      ref: "sp-1",
      tx: "Abc",
      token: "usdc.testnet",
      symbol: "USDC",
      network: "testnet",
      explorerTx: "https://testnet.nearblocks.io/txns/Abc",
      at: new Date(Date.UTC(2026, 10, 12, 9, 30)),
    });
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toBe("date_utc,network,payer,recipient,purpose,amount,token,status,reference,transaction,explorer");
    expect(rows[1]).toBe('2026-11-12T09:30:00.000Z,NEAR testnet,acme.testnet,ada.testnet,"salary, March",1200.00,USDC,paid,sp-1,Abc,https://testnet.nearblocks.io/txns/Abc');
    expect(rows[2]).toContain("'=HYPERLINK(1),0.50,USDC,returned to payer");
  });

  it("defuses formula cells", () => {
    expect(csvField("=1+1")).toBe("'=1+1");
    expect(csvField("-5")).toBe("'-5");
  });
});
