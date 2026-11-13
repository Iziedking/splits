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
  { name: "splash", path: "/near", splash: true },
  { name: "home", path: "/near" },
  { name: "app-overview", path: "/near/app" },
  { name: "payroll-empty", path: "/near/payroll" },
  {
    name: "payroll-uploaded",
    path: "/near/payroll",
    act: async (p) => {
      const rows = ["account,amount,purpose", "tax.kingizie.testnet,0.30,payroll tax", "savings.kingizie.testnet,0.20,pension", "mum.kingizie.testnet,0.50,salary"];
      await p.locator("#payroll-file").setInputFiles({ name: "march-payroll.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
      await p.getByRole("button", { name: "Check the list", exact: true }).click();
      await p.getByText("Total", { exact: true }).waitFor({ timeout: 20_000 });
    },
  },
  { name: "group-choose", path: "/near/group" },
  // A DAO made by near/proof/testnet-proof.mjs: two members, one passed vote, a saved split.
  { name: "group-view", path: "/near/group?dao=splits-proof-bcb0d8.sputnikv2.testnet", wait: "Votes on the split" },
  { name: "send-empty", path: "/near/send" },
  {
    name: "send-sample-review",
    path: "/near/send?sample=1",
    act: async (p) => {
      await p.getByRole("button", { name: "Check the list", exact: true }).click();
      await p.getByText("Total", { exact: true }).waitFor({ timeout: 20_000 });
    },
  },
  {
    name: "send-problems",
    path: "/near/send",
    act: async (p) => {
      await p.getByLabel("Person 1: email or Splits account").fill("Ada@gmail.com");
      await p.getByLabel("Person 1: amount").fill("12.345");
      await p.getByRole("button", { name: "Check the list", exact: true }).click();
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
  { name: "pay-link", path: "/near/pay/kingizie.testnet", wait: "divides automatically", act: (p) => p.getByLabel(/^Amount/).fill("25") },
  { name: "pay-link-no-split", path: "/near/pay/nobody-here-12345.testnet", wait: "set up a split" },
  { name: "receipt-recipient", path: `/near/r/${HAND}?from=kingizie.testnet&to=mum.kingizie.testnet` },
  { name: "receipt-whole", path: `/near/r/${SAVED}?from=mum.kingizie.testnet` },
  { name: "how", path: "/near/how" },
  { name: "shop", path: "/near/shop" },
  { name: "shop-buy", path: "/near/shop", act: async (p) => { await p.getByRole("link", { name: "Pay with Splits" }).click(); await p.getByText("Your payment divides as it arrives").waitFor({ timeout: 20_000 }); } },
  { name: "button-setup", path: "/near/button", act: (p) => p.getByRole("button", { name: "Fill the coffee shop example" }).click() },
  // End to end, only where email accounts are on (an app account in .env.local): sign in with an
  // email (the preview shows the code on screen), land on Home with an account made behind the
  // scenes, then save the example split through the relayer. Wider screens only; it makes accounts.
  {
    name: "email-signin",
    path: "/near/app",
    only: 1280,
    act: async (p) => {
      if ((await p.request.get(BASE + "/api/near/me")).status() === 404) return;
      await p.getByRole("button", { name: "Sign in", exact: true }).first().click();
      await p.getByLabel("Email").fill(`judge+${Date.now()}@example.com`);
      await p.getByRole("button", { name: "Send me a code" }).click();
      const hint = await p.getByText(/your code is \d{6}/).textContent({ timeout: 20_000 });
      await p.screenshot({ path: path.join(OUT, "email-code-1280.png") });
      // Six boxes; a pasted or filled code spreads across them and signs in on the last digit.
      await p.getByLabel("Digit 1 of 6").fill(hint.match(/\d{6}/)[0]);
      await p.getByLabel("Digit 6 of 6").waitFor();
      const t0 = Date.now();
      await p.getByText("Add $5.00 of test money").waitFor({ timeout: 120_000 });
      console.log(`email-signin: signed in, account made, in ${Date.now() - t0}ms`);
      await p.screenshot({ path: path.join(OUT, "email-home-1280.png"), fullPage: true });
      await p.goto(BASE + "/near/split", { waitUntil: "networkidle" });
      await p.getByRole("button", { name: "Turn it into a split" }).click();
      await p.getByRole("button", { name: "Save this split" }).click();
      const t1 = Date.now();
      await p.getByText("Saved on NEAR.").waitFor({ timeout: 120_000 });
      console.log(`email-signin: split saved through the relayer in ${Date.now() - t1}ms`);
      // Pockets read by name, the address one tap away.
      await p.getByRole("button", { name: "Your tax pocket" }).first().waitFor({ timeout: 20_000 });
      await p.screenshot({ path: path.join(OUT, "email-split-names-1280.png"), fullPage: true });
      // The profile: round initials, room for a picture.
      await p.goto(BASE + "/near/profile", { waitUntil: "networkidle" });
      await p.getByRole("button", { name: "Add a picture" }).waitFor({ timeout: 20_000 });
      await p.screenshot({ path: path.join(OUT, "email-profile-1280.png"), fullPage: true });
      // Pay someone new by their email: Splits makes their account; the review shows them by email.
      const friend = `friend+${Date.now()}@example.com`;
      await p.goto(BASE + "/near/send", { waitUntil: "networkidle" });
      await p.getByLabel("Person 1: email or Splits account").fill(friend);
      await p.getByLabel("Person 1: amount").fill("0.10");
      await p.getByLabel("Person 1: what it's for").fill("coffee");
      await p.getByRole("button", { name: "Remove" }).nth(1).click();
      await p.getByRole("button", { name: "Check the list" }).click();
      const t2 = Date.now();
      await p.getByRole("button", { name: friend }).waitFor({ timeout: 120_000 });
      console.log(`email-signin: paid-by-email friend set up and reviewed in ${Date.now() - t2}ms`);
      await p.screenshot({ path: path.join(OUT, "email-pay-by-email-1280.png"), fullPage: true });
    },
  },
  { name: "bill-setup", path: "/near/bill", act: (p) => p.getByRole("button", { name: "Fill the dinner example" }).click() },
  { name: "bill-tab", path: "/near/tab?b=eyJ2IjoxLCJpIjoiZGVtbzI2MTEiLCJ0IjoiRGlubmVyIGF0IFllbGxvdyBDaGlsbGkiLCJoIjoia2luZ2l6aWUudGVzdG5ldCIsIm4iOiJJc3JhZWwiLCJhIjoiNTkuNDAiLCJwIjpbWyJCbyIsImJvLnNwbGl0cy1mbGF0LW13ZHB0ODJzZGQ0OS50ZXN0bmV0IiwiMTQuODUiXSxbIkNoaSIsInNwbGl0cy1kZW1vLXRpcGphci50ZXN0bmV0IiwiMTQuODUiXSxbIkRheW8iLCJsYW5kbG9yZC5zcGxpdHMtZmxhdC1td2RwdDgyc2RkNDkudGVzdG5ldCIsIjE0Ljg1Il1dfQ", wait: "0 of 3 paid" },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const report = [];
try {
  for (const width of WIDTHS) {
    for (const shot of SHOTS) {
      if (shot.only && shot.only !== width) continue;
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      // The opening splash shows once per tab session; skip it so each shot shows the screen itself.
      if (!shot.splash) await context.addInitScript(() => sessionStorage.setItem("splits-near-splash", "1"));
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      const res = await page.goto(BASE + shot.path, { waitUntil: shot.splash ? "domcontentloaded" : "networkidle" });
      if (shot.wait) await page.getByText(shot.wait).first().waitFor({ timeout: 20_000 });
      if (shot.act) await shot.act(page);
      await page.waitForTimeout(shot.splash ? 0 : 400);
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
