import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Notice } from "@/components/ui/field";
import type { ActivityView, PayoutCheck } from "@/lib/api";
import { ActivityList } from "./activity-list";
import { ReviewTable } from "./review-table";

/** Honest states and live regions (fintech face WP4). */

const html = (node: ReactElement) => renderToStaticMarkup(node);
const noop = () => undefined;
const EMPTY = "Money you send and receive shows here";

describe("Notice", () => {
  it("announces errors and successes, and reads plain information in place", () => {
    expect(html(<Notice tone="error">x</Notice>)).toContain('role="alert"');
    expect(html(<Notice tone="success">x</Notice>)).toContain('role="status"');
    expect(html(<Notice>x</Notice>)).not.toContain("role=");
  });
  it("lets live override the default either way", () => {
    expect(html(<Notice live>x</Notice>)).toContain('role="status"');
    expect(html(<Notice tone="error" live={false}>x</Notice>)).not.toContain("role=");
  });
});

describe("ActivityList states never overlap", () => {
  it("loading: placeholders only", () => {
    const out = html(<ActivityList activity={null} splitNames={{}} onRetry={noop} />);
    expect(out).toContain("Loading activity");
    expect(out).not.toContain(EMPTY);
  });

  it("failed: the error and Try again, not the empty copy", () => {
    const out = html(<ActivityList activity={null} error="Your history didn't load." splitNames={{}} onRetry={noop} />);
    expect(out).toContain("Your history didn&#x27;t load.");
    expect(out).toContain("Try again");
    expect(out).not.toContain(EMPTY);
    expect(out).not.toContain("Loading activity");
  });

  it("empty: the empty copy alone", () => {
    const out = html(<ActivityList activity={{ sent: [], received: [], receivedError: null }} splitNames={{}} onRetry={noop} />);
    expect(out).toContain(EMPTY);
    expect(out).not.toContain('role="alert"');
  });

  it("partly loaded: received money unknown, so no claim that there is nothing", () => {
    const activity: ActivityView = { sent: [], received: [], receivedError: "Money you received didn't load." };
    const out = html(<ActivityList activity={activity} splitNames={{}} onRetry={noop} />);
    expect(out).toContain("Money you received didn&#x27;t load.");
    expect(out).not.toContain(EMPTY);
  });
});

describe("ReviewTable", () => {
  const check: PayoutCheck = {
    lines: [
      { line: 1, raw: "a@example.com, 3", recipient: "a@example.com", amount: "3.00", label: "rent", status: "ready", message: null },
      { line: 2, raw: "a@example.com, 3", recipient: "a@example.com", amount: "3.00", label: "rent", status: "duplicate", message: "This person is already on the list" },
    ],
    total: "3.00",
    ready: false,
    totalUnits: "3000000",
    fee: null,
    feePercent: 0,
    charge: null,
    maxRecipients: 500,
    draft: null,
  };
  const out = html(<ReviewTable check={check} />);

  it("is a list, not a table whose grid layout hides its rows", () => {
    expect(out).not.toContain("<table");
    expect(out.match(/<li/g)).toHaveLength(2);
  });

  it("has one live sentence: the summary", () => {
    expect(out.match(/role="status"/g)).toHaveLength(1);
    expect(out).toContain("2 people checked, 1 ready, $3.00 in total.");
  });
});
