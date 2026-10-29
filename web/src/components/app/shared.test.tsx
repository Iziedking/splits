import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, ButtonLink, buttonClass } from "@/components/ui/button";
import { BackLink } from "./back-link";
import { EnvBadge } from "./env-badge";
import { nextIndex, Segmented, tabPanelProps } from "./segmented";
import { Sheet } from "./sheet";
import { Skeleton } from "./skeleton";
import { StepList } from "./step-list";
import { Switch } from "./switch";

/** The shared components (fintech face WP3) and a guard that the hand-rolled copies stay gone. */

const noop = () => undefined;
const html = (node: ReactElement) => renderToStaticMarkup(node);

describe("nextIndex", () => {
  const none = [false, false, false];
  it("moves with the arrows and wraps", () => {
    expect(nextIndex("ArrowRight", 0, none)).toBe(1);
    expect(nextIndex("ArrowDown", 2, none)).toBe(0);
    expect(nextIndex("ArrowLeft", 0, none)).toBe(2);
    expect(nextIndex("ArrowUp", 1, none)).toBe(0);
  });
  it("jumps to the ends with Home and End", () => {
    expect(nextIndex("Home", 2, none)).toBe(0);
    expect(nextIndex("End", 0, none)).toBe(2);
  });
  it("skips disabled options", () => {
    expect(nextIndex("ArrowRight", 0, [false, true, false])).toBe(2);
    expect(nextIndex("Home", 2, [true, false, false])).toBe(1);
    expect(nextIndex("End", 0, [false, false, true])).toBe(1);
  });
  it("ignores other keys", () => {
    expect(nextIndex("Enter", 0, none)).toBeNull();
    expect(nextIndex("a", 0, none)).toBeNull();
  });
});

describe("Segmented", () => {
  const options = [
    { value: "one", label: "One person" },
    { value: "many", label: "Many people" },
  ];

  it("is a tablist whose tabs name their panels, with one tab stop", () => {
    const out = html(<Segmented kind="tabs" label="Who gets paid" idBase="t" options={options} value="many" onChange={noop} />);
    expect(out).toContain('role="tablist"');
    expect(out.match(/role="tab"/g)).toHaveLength(2);
    expect(out).toContain('id="t-tab-many"');
    expect(out).toContain('aria-controls="t-panel-many"');
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out.match(/tabindex="-1"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-selected="true"[^>]*tabindex="0"/);
    expect(out).toContain("min-h-11");
    expect(out).toContain("whitespace-nowrap");
  });

  it("is a radiogroup with aria-checked when it sets a value", () => {
    const out = html(<Segmented kind="radio" label="How to share it" options={options} value="one" onChange={noop} />);
    expect(out).toContain('role="radiogroup"');
    expect(out.match(/role="radio"/g)).toHaveLength(2);
    expect(out).toContain('aria-checked="true"');
    expect(out).not.toContain("aria-selected");
  });

  it("gives the tab panel its matching id and label", () => {
    expect(tabPanelProps("t", "one")).toEqual({ id: "t-panel-one", role: "tabpanel", "aria-labelledby": "t-tab-one", tabIndex: 0 });
  });
});

describe("Sheet", () => {
  it("labels and describes the dialog, and has one 44px close button named Close", () => {
    const out = html(
      <Sheet open={false} onClose={noop} title="Share a receipt" description="One person's part.">
        <p>body</p>
      </Sheet>,
    );
    const titleId = out.match(/aria-labelledby="([^"]+)"/)![1]!;
    const descriptionId = out.match(/aria-describedby="([^"]+)"/)![1]!;
    expect(out).toContain(`id="${titleId}" tabindex="-1"`);
    expect(out).toContain(`id="${descriptionId}"`);
    expect(out.match(/aria-label="Close"/g)).toHaveLength(1);
    expect(out).toContain("h-11 w-11");
    expect(out).toContain("backdrop:bg-foreground/40");
    expect(out).toContain("shadow-dialog");
  });

  it("can be described by content inside it", () => {
    const out = html(
      <Sheet open={false} onClose={noop} title="Approve" variant="centre" describedBy="what">
        <div id="what">$5.00</div>
      </Sheet>,
    );
    expect(out).toContain('aria-describedby="what"');
    expect(out).toContain("max-w-sm");
  });
});

describe("StepList", () => {
  const out = html(
    <StepList
      steps={[
        { key: "a", label: "Approved", state: "done" },
        { key: "b", label: "Sent", state: "failed" },
        { key: "c", label: "Checked", state: "active" },
        { key: "d", label: "Receipts", state: "waiting" },
      ]}
    />,
  );
  it("says every state in words", () => {
    for (const word of [": done", ": failed", ": in progress", ": not started"]) expect(out).toContain(word);
  });
  it("draws a different shape for done and failed, not only a colour", () => {
    expect(out).toContain("lucide-check");
    expect(out).toContain("lucide-x");
  });
});

describe("EnvBadge", () => {
  it("reads its reason out instead of hiding it in a tooltip", () => {
    const out = html(<EnvBadge mode="testnet" />);
    expect(out).toContain(">Test<");
    expect(out).toContain('class="sr-only"');
    expect(out).toContain("Test money with no value");
    expect(out).not.toMatch(/Arc|USDC/);
    expect(out).not.toContain("title=");
  });
});

describe("Skeleton", () => {
  it("announces what is loading, once, as a status", () => {
    const out = html(<Skeleton label="Loading activity" rows={2} className="h-8" />);
    expect(out).toContain('role="status"');
    expect(out.match(/Loading activity/g)).toHaveLength(1);
    expect(out.match(/aria-hidden="true"/g)).toHaveLength(2);
  });
});

describe("Switch", () => {
  it("is a switch with its state", () => {
    const out = html(<Switch checked label="Email me" description="Deposits ready" onChange={noop} />);
    expect(out).toContain('role="switch"');
    expect(out).toContain('aria-checked="true"');
    expect(out).toContain("Deposits ready");
  });
});

describe("ButtonLink and BackLink", () => {
  it("looks exactly like the Button it stands for", () => {
    const link = html(
      <ButtonLink href="/pay" variant="secondary" size="sm">
        Pay
      </ButtonLink>,
    );
    const button = html(
      <Button variant="secondary" size="sm">
        Pay
      </Button>,
    );
    const cls = (s: string) => s.match(/class="([^"]+)"/)![1];
    expect(cls(link)).toBe(cls(button));
    expect(cls(link)).toBe(buttonClass({ variant: "secondary", size: "sm" }));
    expect(link).toContain('href="/pay"');
  });

  it("is a link with href, a button with onClick", () => {
    expect(html(<BackLink href="/home" />)).toMatch(/^<a [^>]*href="\/home"/);
    expect(html(<BackLink onClick={noop} />)).toMatch(/^<button type="button"/);
    expect(html(<BackLink href="/x" label="Back to payment" />)).toContain("Back to payment");
  });
});

/** Every UI file, minus tests and the shared components that own each pattern. */
const SRC = fileURLToPath(new URL("../../", import.meta.url));
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}
const UI = ["app", "components"].flatMap((d) => files(join(SRC, d)));
function offenders(pattern: RegExp, owners: string[]): string[] {
  return UI.filter((f) => !owners.some((o) => f.endsWith(join(...o.split("/")))))
    .flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (pattern.test(line) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 100)}`] : [])),
    );
}

describe("one home for each pattern", () => {
  it("opens dialogs only through Sheet", () => {
    expect(offenders(/showModal\(|<dialog\b/, ["components/app/sheet.tsx"])).toEqual([]);
  });
  it("builds tabs and radio groups only through Segmented (the card-style funding choice aside)", () => {
    expect(offenders(/role="(tab|tablist|radio|radiogroup)"/, ["components/app/segmented.tsx", "components/app/funding-choice.tsx"])).toEqual([]);
  });
  it("builds switches only through Switch", () => {
    expect(offenders(/role="switch"/, ["components/app/switch.tsx"])).toEqual([]);
  });
  it("draws pills only through Button and ButtonLink", () => {
    expect(offenders(/min-h-\[52px\]/, ["components/ui/button.tsx"])).toEqual([]);
  });
  it("has no tooltip-only explanations", () => {
    // The review table's title only repeats a name the cell already holds in full for screen readers.
    expect(offenders(/<span[^>]*\stitle=/, ["components/app/review-table.tsx"])).toEqual([]);
  });
  it("keeps progress lists in StepList", () => {
    expect(offenders(/aria-label="Progress"/, ["components/app/step-list.tsx"])).toEqual([]);
  });
  it("keeps loading placeholders in Skeleton", () => {
    expect(offenders(/aria-busy="true"/, ["components/app/skeleton.tsx"])).toEqual([]);
  });
});
