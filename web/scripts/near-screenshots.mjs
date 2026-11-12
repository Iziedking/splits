// Screenshots of NEAR mode for the evidence folder. Runs against a preview server started with
// NEAR_ENABLED=1, reads real data from NEAR testnet (the router splits.kingizie.testnet, its saved
// split and a real payment), and shoots each screen at the widths given. No wallet is connected, so
// screens that need one show their signed-out state.
//
//   node scripts/near-screenshots.mjs --base http://127.0.0.1:3919 --out ../evidence/near --widths 375,1280
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const BASE = args.base ?? "http://127.0.0.1:3919";
const OUT = path.resolve(args.out ?? "../evidence/near");
const WIDTHS = (args.widths ?? "375,1280").split(",").map(Number);

// Real testnet transactions from 2026-11-12: a 3-part split, and a payment divided by a saved split.
const HAND = "99VCLC4F4FKZYDaPLJxr14ThM6gvem1RcSLDVVFmRW1M";
const SAVED = "DWpdDLmdLrCWxtVgSg9fhQFmExnZWmnKpvK4529cpC4b";

const SHOTS = [
  { name: "home", path: "/near" },
  { name: "send-empty", path: "/near/send" },
  {
    name: "send-sample-review",
    path: "/near/send?sample=1",
    act: async (p) => {
      await p.getByRole("button", { name: "Check the list" }).click();
      await p.getByText("Total", { exact: true }).waitFor({ timeout: 20_000 });
    },
  },
  {
    name: "send-problems",
    path: "/near/send",
    act: async (p) => {
      await p.getByLabel("Person 1: NEAR account").fill("Ada@gmail.com");
      await p.getByLabel("Person 1: amount").fill("12.345");
      await p.getByRole("button", { name: "Check the list" }).click();
    },
  },
  {
    name: "send-describe",
    path: "/near/send",
    act: async (p) => {
      await p.getByText("Describe it, I split it").click();
      await p.getByLabel(/Paste a message/).fill("tax.kingizie.testnet 5 for tax\nmum.kingizie.testnet 20 for upkeep");
      await p.getByRole("button", { name: "Fill the list" }).click();
      await p.waitForFunction(() => [...document.querySelectorAll("input")].some((i) => i.value === "mum.kingizie.testnet"), null, { timeout: 10_000 });
    },
  },
  { name: "split-signed-out", path: "/near/split" },
  { name: "pay-link", path: "/near/pay/kingizie.testnet", wait: "Version", act: (p) => p.getByLabel(/^Amount/).fill("25") },
  { name: "pay-link-no-split", path: "/near/pay/nobody-here-12345.testnet", wait: "no saved split" },
  { name: "receipt-recipient", path: `/near/r/${HAND}?from=kingizie.testnet&to=mum.kingizie.testnet` },
  { name: "receipt-whole", path: `/near/r/${SAVED}?from=mum.kingizie.testnet` },
  { name: "how", path: "/near/how" },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const report = [];
try {
  for (const width of WIDTHS) {
    for (const shot of SHOTS) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      const res = await page.goto(BASE + shot.path, { waitUntil: "networkidle" });
      if (shot.wait) await page.getByText(shot.wait).first().waitFor({ timeout: 20_000 });
      if (shot.act) await shot.act(page);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const file = `${shot.name}-${width}.png`;
      await page.screenshot({ path: path.join(OUT, file), fullPage: true });
      report.push({ shot: shot.name, width, status: res?.status(), horizontalOverflowPx: overflow, errors });
      console.log(`${file} status=${res?.status()} overflow=${overflow}px errors=${errors.length}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
