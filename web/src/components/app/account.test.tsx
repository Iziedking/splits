import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReceiptView, TransferView } from "@/lib/api";
import { cents, TRACKER_STEP } from "@/lib/format";
import { AddMoneySheet } from "./add-money-sheet";
import { Landed } from "./landed";
import { MONEY_NOTICE, MoneyNotice } from "./money-notice";
import { ReceiptCard } from "./receipt-card";
import { ReceiveSheet } from "./receive-sheet";

/**
 * The account surfaces (fintech face WP5): a consumer reads money, not rails. Crypto words may
 * appear only inside the Payment details fold, or the crypto wallet panel someone chose to open.
 */

const FORBIDDEN = /\bArc\b|USDC|0x[0-9a-fA-F]|\bEVM\b|explorer|transaction/i;
const ADDRESS = "0x8eDb15a372D3b691E2264fFc897EC53dFF4A64F2";
const TX = "0x8f3c12aa00000000000000000000000000000000000000000000000000a12b";
const noop = () => undefined;
/** The notice as React writes it into markup (the apostrophe escaped). */
const NOTICE_HTML = MONEY_NOTICE.replace(/'/g, "&#x27;");

const html = (node: ReactElement) => renderToStaticMarkup(node);
/** The visible words outside the fold and the crypto panel. */
function outside(markup: string): string {
  return markup
    .replace(/<details data-payment-details[\s\S]*?<\/details>/g, "")
    .replace(/<section data-crypto-path[\s\S]*?<\/section>/g, "")
    .replace(/<[^>]+>/g, " ");
}

const receipt: ReceiptView = {
  index: 0,
  whole: false,
  name: "Landlord",
  purpose: "rent",
  amount: "40.00",
  to: ADDRESS,
  from: "Ada",
  fromAddress: "0x00000000000000000000000000000000000000a1",
  paidAt: "2026-10-29T10:00:00.000Z",
  txHash: TX,
  explorerUrl: `https://explorer.arc.io/tx/${TX}`,
  network: "arc",
  simulated: false,
};

const transfer = {
  id: "t1",
  kind: "pay",
  status: "settled",
  splitId: null,
  amount: "100.00",
  fee: "1.50",
  feePercent: 1.5,
  total: "101.50",
  whole: null,
  quote: null,
  recipients: 3,
  legs: [
    { name: "Landlord", purpose: "rent", amount: "40.00", address: ADDRESS, receipt: "/r/a" },
    { name: "School", purpose: "school fees", amount: "35.00", address: ADDRESS, receipt: "/r/b" },
    { name: "Sister", purpose: "upkeep", amount: "25.00", address: ADDRESS, receipt: "/r/c" },
  ],
  txHash: TX,
  explorerUrl: `https://explorer.arc.io/tx/${TX}`,
  error: null,
  parentTransferId: null,
  createdAt: "2026-10-29T10:00:00.000Z",
  settledAt: "2026-10-29T10:00:02.000Z",
  steps: [],
} as unknown as TransferView;

describe("the receipt", () => {
  const out = html(<ReceiptCard receipt={receipt} />);

  it("reads as money: name, amount, purpose, who paid, and paid and checked", () => {
    expect(out).toContain("Received.");
    expect(out).toContain("$40.00");
    expect(out).toContain("For rent");
    expect(out).toContain("Ada");
    expect(out).toContain("Paid and checked");
    expect(out).toContain("Splits checked this payment before marking it paid.");
  });

  it("keeps addresses, network, reference and the proof link inside Payment details", () => {
    expect(outside(out)).not.toMatch(FORBIDDEN);
    const fold = out.match(/<details data-payment-details[\s\S]*?<\/details>/)![0];
    expect(fold).toContain(ADDRESS);
    expect(fold).toContain("Arc");
    expect(fold).toContain("Proof of payment");
  });

  it("says plainly when it is a test receipt", () => {
    const test = html(<ReceiptCard receipt={{ ...receipt, simulated: true, explorerUrl: null }} />);
    expect(test).toContain("Paid (test)");
    expect(test).toContain("This is a test receipt. No money moved.");
  });
});

describe("Landed", () => {
  const out = html(<Landed t={transfer} preview={false} returnTo="/payments/t1" actions={null} />);

  it("says who it reached in people, not wallets", () => {
    expect(out).toContain("3 people");
    expect(out).not.toMatch(/wallets?\b/);
  });

  it("puts the proof of payment in the fold", () => {
    expect(outside(out)).not.toMatch(FORBIDDEN);
    expect(out).toContain("Proof of payment");
  });
});

describe("Add money and Receive", () => {
  it("lists ways to add money in money words, with the notice", () => {
    const out = html(<AddMoneySheet address={ADDRESS} network="arc" open={false} onClose={noop} />);
    expect(out).toContain("From a crypto wallet");
    expect(out).toContain(NOTICE_HTML);
    expect(outside(out)).not.toMatch(FORBIDDEN);
    expect(out).not.toContain("EVM chains");
  });

  it("leads with the email; the address waits in its own fold", () => {
    const out = html(<ReceiveSheet email="ada@example.com" address={ADDRESS} open={false} onClose={noop} />);
    expect(out).toContain("People on Splits can pay your email.");
    expect(out).toContain("ada@example.com");
    expect(outside(out)).not.toMatch(FORBIDDEN);
    expect(out).toContain(ADDRESS);
  });
});

describe("the money notice", () => {
  it("says what the balance is without rail words", () => {
    expect(MONEY_NOTICE).toMatch(/not a bank/);
    expect(MONEY_NOTICE).toMatch(/Circle/);
    expect(MONEY_NOTICE).toMatch(/deposit insurance/);
    expect(MONEY_NOTICE).toMatch(/PIN/);
    expect(MONEY_NOTICE).not.toMatch(FORBIDDEN);
    expect(html(<MoneyNotice />)).toContain(NOTICE_HTML);
  });
});

describe("balances in cents", () => {
  it("never shows a third decimal, and never rounds up", () => {
    expect(cents("59.994")).toBe("59.99");
    expect(cents("0.999999")).toBe("0.99");
    expect(cents("12")).toBe("12.00");
  });
  it("names the tracker steps in plain words", () => {
    expect(Object.values(TRACKER_STEP)).toEqual(["Paid in", "Approved", "Sent", "Receipts ready"]);
  });
});
