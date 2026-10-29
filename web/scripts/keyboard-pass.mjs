// The keyboard pass for the shared components (fintech face WP3): Tab, the arrow keys, Escape and
// focus return on Pay, Add money, Notifications and Share a receipt, against a preview server.
// Every step records where focus is; a step whose expectation fails makes the run fail. Writes
// keyboard-pass.json and a screenshot of each open dialog to --out.
//
// Runs in the Playwright container on the VPS, like screenshots.mjs.
//
//   node scripts/keyboard-pass.mjs --base http://127.0.0.1:3918 --out ../evidence/wp3
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { previewSession, settledPayment } from "./preview-session.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const BASE = args.base ?? "http://127.0.0.1:3918";
const OUT = path.resolve(args.out ?? "../evidence");

/** What has focus: tag, role, accessible-ish name, and the state attributes that matter here. */
function focused(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: "body", trapped: Boolean(document.querySelector("dialog[open]")) };
    const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") ?? undefined,
      id: el.id || undefined,
      name,
      selected: el.getAttribute("aria-selected") ?? el.getAttribute("aria-checked") ?? undefined,
      controls: el.getAttribute("aria-controls") ?? undefined,
      controlsExists: el.getAttribute("aria-controls") ? Boolean(document.getElementById(el.getAttribute("aria-controls"))) : undefined,
      inDialog: Boolean(el.closest("dialog[open]")),
      trapped: Boolean(el.closest("dialog[open]")),
    };
  });
}

const results = [];
let failures = 0;

async function step(page, scenario, action, expect) {
  const at = await focused(page);
  const problems = Object.entries(expect ?? {}).filter(([k, v]) => (v instanceof RegExp ? !v.test(String(at[k] ?? "")) : at[k] !== v));
  const ok = problems.length === 0;
  if (!ok) failures++;
  results.push({ scenario, action, focus: at, ok, ...(ok ? {} : { expected: Object.fromEntries(problems.map(([k, v]) => [k, String(v)])) }) });
  console.log(`${ok ? "ok" : "FAIL"} - ${scenario}: ${action} -> ${at.role ?? at.tag} "${at.name ?? ""}"${at.selected ? ` (${at.selected})` : ""}`);
}

/** Tabs forward until focus satisfies `match`, as a keyboard user would reach it. */
async function tabTo(page, match, limit = 40) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    const at = await focused(page);
    if (match(at)) return i + 1;
  }
  throw new Error("never reached by Tab");
}

const dialogOpen = (page) => page.evaluate(() => Boolean(document.querySelector("dialog[open]")));

async function pay(page) {
  const s = "pay";
  await page.goto(`${BASE}/pay`, { waitUntil: "networkidle" });
  const presses = await tabTo(page, (f) => f.role === "tab");
  await step(page, s, `Tab x${presses} reaches the tabs`, { role: "tab", name: "One person", selected: "true" });
  await page.keyboard.press("ArrowRight");
  await step(page, s, "ArrowRight", { role: "tab", name: "Many people", selected: "true", controlsExists: true });
  await page.keyboard.press("ArrowRight");
  await step(page, s, "ArrowRight", { name: "Saved split", selected: "true", controlsExists: true });
  await page.keyboard.press("ArrowRight");
  await step(page, s, "ArrowRight wraps", { name: "One person", selected: "true" });
  await page.keyboard.press("End");
  await step(page, s, "End", { name: "Saved split", selected: "true" });
  await page.keyboard.press("Home");
  await step(page, s, "Home", { name: "One person", selected: "true" });
  await page.keyboard.press("ArrowLeft");
  await step(page, s, "ArrowLeft wraps", { name: "Saved split", selected: "true" });
  await page.keyboard.press("ArrowLeft");
  await step(page, s, "ArrowLeft", { name: "Many people", selected: "true" });
  await page.keyboard.press("Tab");
  await step(page, s, "Tab leaves the tablist (one tab stop)", { role: /^(?!tab$)/ });

  const radio = await tabTo(page, (f) => f.role === "radio");
  await step(page, s, `Tab x${radio} reaches How to share it`, { role: "radio", name: "Split equally", selected: "true" });
  await page.keyboard.press("ArrowRight");
  await step(page, s, "ArrowRight", { role: "radio", name: "Set amounts", selected: "true" });

  // The approval dialog: focus starts on the PIN, stays inside, Escape closes it.
  await page.getByRole("tab", { name: "One person" }).click();
  await page.getByLabel("Email or Arc address").fill("landlord@example.com");
  await page.getByLabel("Amount (USDC)").fill("2");
  await page.getByLabel("What it's for").fill("rent");
  await page.getByRole("button", { name: /check/i }).first().click();
  const payButton = page.getByRole("button", { name: /^Pay \$/ });
  await payButton.waitFor({ timeout: 10_000 });
  await payButton.focus();
  await page.keyboard.press("Enter");
  await page.locator("dialog[open]").waitFor();
  await page.waitForTimeout(400);
  await step(page, s, "Enter on Pay opens the approval", { id: "confirm-pin", inDialog: true });
  await page.screenshot({ path: path.join(OUT, "keyboard-pay-approval.png") });
  // A modal traps focus in the page: past its last control, Tab visits the browser's own toolbar
  // (document.activeElement is then body) and comes back to the dialog, never to the page behind it.
  for (let i = 1; i <= 6; i++) {
    await page.keyboard.press("Tab");
    await step(page, s, `Tab ${i} stays in the approval`, { trapped: true });
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  results.push({ scenario: s, action: "Escape closes the approval", ok: !(await dialogOpen(page)), focus: await focused(page) });
  if (await dialogOpen(page)) failures++;
}

/** Opens a dialog from a focused control with Enter; checks focus on the title, a Tab, Escape, return. */
async function dialogFrom(page, scenario, opener, title, extra) {
  await opener.focus();
  await page.keyboard.press("Enter");
  await page.locator("dialog[open]").waitFor();
  await page.waitForTimeout(400);
  await step(page, scenario, "Enter opens it, focus on the title", { tag: "h2", name: title, inDialog: true });
  await page.screenshot({ path: path.join(OUT, `keyboard-${scenario}.png`) });
  if (extra) await extra();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const closed = !(await dialogOpen(page));
  if (!closed) failures++;
  results.push({ scenario, action: "Escape closes it", ok: closed });
  await step(page, scenario, "focus returns to the opener", { tag: "button", inDialog: false });
}

async function addMoney(page) {
  const s = "add-money";
  await page.goto(`${BASE}/profile`, { waitUntil: "networkidle" });
  await dialogFrom(page, s, page.getByRole("button", { name: "Add money" }), "Add money", async () => {
    await page.keyboard.press("Tab");
    await step(page, s, "Tab", { inDialog: true });
    const t = await tabTo(page, (f) => f.role === "tab", 10);
    await step(page, s, `Tab x${t} reaches the network tabs`, { role: "tab", name: "EVM chains", selected: "true" });
    await page.keyboard.press("ArrowRight");
    await step(page, s, "ArrowRight", { role: "tab", name: "Solana", selected: "true", controlsExists: true });
    await page.keyboard.press("ArrowLeft");
    await step(page, s, "ArrowLeft", { role: "tab", name: "EVM chains", selected: "true", controlsExists: true });
  });
}

async function notifications(page) {
  const s = "notifications";
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  await dialogFrom(page, s, page.getByRole("button", { name: /^Notifications/ }), "Notifications", async () => {
    await page.keyboard.press("Tab");
    await step(page, s, "Tab", { inDialog: true, name: /Clear all|Close/ });
    await page.keyboard.press("Tab");
    await step(page, s, "Tab", { inDialog: true });
  });
}

async function shareReceipt(page, paymentId) {
  const s = "share-receipt";
  await page.goto(`${BASE}/payments/${paymentId}`, { waitUntil: "networkidle" });
  await dialogFrom(page, s, page.getByRole("button", { name: "Share a receipt" }), "Share a receipt", async () => {
    await page.keyboard.press("Tab");
    await step(page, s, "Tab", { inDialog: true, name: "Close" });
    await page.keyboard.press("Tab");
    await step(page, s, "Tab", { inDialog: true, name: /receipt/ });
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const session = await previewSession(BASE, `keys-${Date.now()}@example.com`);
  const paymentId = await settledPayment(session.call);
  const browser = await chromium.launch();
  try {
    for (const run of [pay, addMoney, notifications, (p) => shareReceipt(p, paymentId)]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      await context.addCookies([{ ...session.cookie, url: BASE, httpOnly: true, sameSite: "Lax" }]);
      const page = await context.newPage();
      try {
        await run(page);
      } catch (err) {
        failures++;
        results.push({ scenario: run.name || "share-receipt", action: "run", ok: false, error: String(err?.message ?? err) });
        console.log(`FAIL - ${run.name}: ${err?.message ?? err}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(OUT, "keyboard-pass.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), failures, results }, null, 2) + "\n");
  console.log(`${results.length - failures}/${results.length} keyboard steps as expected`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
