// Screenshots of the preview app for the evidence folder (docs/audits/evidence/...). Runs against
// a preview server (SPLITS_MODE=preview) over HTTP, signs a person in through the real email-code
// flow, builds a split, and shoots each screen at the widths given. Two states are forced through
// request interception: /api/me with demoCard=false (what a live mainnet account sees) and a failing
// /api/earn (the Earn page's error state).
//
// Meant for the Playwright container on the VPS (mcr.microsoft.com/playwright:v1.63.0-noble), where
// playwright-core 1.63.0 finds its browsers in PLAYWRIGHT_BROWSERS_PATH. Docs read 2026-10-29:
// https://playwright.dev/docs/docker and https://playwright.dev/docs/api/class-route#route-fulfill
//
//   node scripts/screenshots.mjs --base http://127.0.0.1:3918 --out ../evidence --widths 320,375,1280
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { previewSession, settledPayment } from "./preview-session.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const BASE = args.base ?? "http://127.0.0.1:3918";
const OUT = path.resolve(args.out ?? "../evidence");
const WIDTHS = (args.widths ?? "375,1280").split(",").map(Number);

/** /api/me as a live mainnet account sees it: the test card is off. */
async function withoutCard(page) {
  await page.route("**/api/me", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    await route.fulfill({ response: res, json: { ...json, demoCard: false } });
  });
}

/** Fills the one-person composer and checks it, so the review column and the funding choice show. */
async function composeOne(page) {
  await page.getByLabel(/^Email or/).fill("landlord@example.com");
  await page.getByLabel(/^Amount/).fill("25");
  await page.getByLabel("What it's for").fill("rent");
  await page.getByRole("button", { name: /check/i }).first().click();
  await page.getByRole("button", { name: /^Pay/ }).waitFor({ timeout: 10_000 });
}

const SHOTS = [
  { name: "landing", path: "/", signedIn: false },
  { name: "signin", path: "/signin", signedIn: false },
  { name: "about", path: "/about", signedIn: false },
  { name: "home", path: "/home" },
  { name: "pay", path: "/pay" },
  { name: "pay-review-test-card-on", path: "/pay", act: composeOne },
  { name: "pay-review-mainnet", path: "/pay", before: withoutCard, act: composeOne },
  { name: "send-split-test-card-on", path: (c) => `/send/${c.splitId}`, act: (p) => p.getByLabel("You send").fill("20") },
  { name: "send-split-mainnet", path: (c) => `/send/${c.splitId}`, before: withoutCard, act: (p) => p.getByLabel("You send").fill("20") },
  { name: "earn", path: "/earn" },
  { name: "earn-load-error", path: "/earn", before: (p) => p.route("**/api/earn", (r) => r.abort("failed")) },
  { name: "profile", path: "/profile" },
  { name: "settings", path: "/settings" },
  { name: "history", path: "/history" },
  // The shared Sheet, open (WP3). The viewport shot shows it the way it sits on screen.
  { name: "sheet-add-money", path: "/profile", act: (p) => openSheet(p, "Add money"), fullPage: false },
  { name: "sheet-notifications", path: "/home", act: (p) => openSheet(p, /^Notifications/), fullPage: false },
  // WP4: the many-people composer (its two-option control), and the states that used to collide.
  { name: "pay-many", path: "/pay?mode=many" },
  { name: "history-load-error", path: "/history", before: (p) => p.route("**/api/activity", (r) => r.abort("failed")) },
  { name: "home-load-error", path: "/home", before: (p) => p.route("**/api/splits", (r) => r.abort("failed")) },
  { name: "profile-rule-error", path: "/profile", before: (p) => p.route("**/api/splits", (r) => r.abort("failed")) },
  {
    name: "notifications-load-error",
    path: "/home",
    before: (p) => p.route("**/api/notifications", (r) => r.abort("failed")),
    act: (p) => openSheet(p, /^Notifications/),
    fullPage: false,
  },
  { name: "payment-not-found", path: "/payments/00000000-0000-0000-0000-000000000000" },
  // WP5: the account surfaces. `vocab` shots fail if a consumer meets crypto words outside the
  // Payment details fold (or the crypto wallet panel, which only people who chose crypto open).
  { name: "sheet-add-money-crypto", path: "/profile", act: (p) => openSheet(p, "Add money").then(() => p.getByRole("button", { name: /From a crypto wallet/ }).click()), fullPage: false },
  { name: "sheet-receive", path: "/home", act: (p) => openSheet(p, "Receive"), fullPage: false, vocab: true },
  { name: "landed", path: (c) => `/payments/${c.paymentId}`, vocab: true },
  { name: "receipt", path: (c) => c.receipt, signedIn: false, vocab: true },
  { name: "receipt-details-open", path: (c) => c.receipt, signedIn: false, act: (p) => p.getByText("Payment details").click() },
];

/** Shots on the consumer path, checked for crypto vocabulary. */
const VOCAB = new Set(["signin", "home", "pay", "pay-review-mainnet", "profile", "sheet-add-money"]);
const FORBIDDEN = /\bArc\b|USDC|0x[0-9a-fA-F]|\bEVM\b|explorer|transaction/i;

/** Visible text outside the fold and the crypto panel, with any crypto words it contains. */
async function vocabulary(page) {
  return page.evaluate((source) => {
    const exempt = [...document.querySelectorAll("[data-payment-details], [data-crypto-path]")];
    const before = exempt.map((el) => el.style.display);
    exempt.forEach((el) => (el.style.display = "none"));
    const text = document.body.innerText;
    exempt.forEach((el, i) => (el.style.display = before[i]));
    const pattern = new RegExp(source, "gi");
    return [...new Set(text.split("\n").filter((line) => pattern.test(line)).map((line) => line.trim().slice(0, 120)))];
  }, FORBIDDEN.source);
}

async function openSheet(page, name) {
  await page.getByRole("button", { name }).click();
  await page.locator("dialog[open]").waitFor();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const session = await previewSession(BASE);
  const paymentId = await settledPayment(session.call);
  const receipt = (await session.call("GET", `/api/transfers/${paymentId}`)).data.transfer.legs[0].receipt;
  const ctx = { ...session, paymentId, receipt };
  const browser = await chromium.launch();
  const manifest = { base: BASE, at: new Date().toISOString(), widths: WIDTHS, shots: [] };
  try {
    for (const width of WIDTHS) {
      for (const shot of SHOTS) {
        const file = `${shot.name}-${width}.png`;
        const context = await browser.newContext({ viewport: { width, height: width < 768 ? 812 : 800 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
        try {
          if (shot.signedIn !== false) {
            await context.addCookies([{ ...ctx.cookie, url: BASE, httpOnly: true, sameSite: "Lax" }]);
          }
          const page = await context.newPage();
          if (shot.before) await shot.before(page);
          const route = typeof shot.path === "function" ? shot.path(ctx) : shot.path;
          await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
          if (shot.act) await shot.act(page);
          await page.waitForTimeout(600);
          // Whole pages: the funding choice and the Pay button sit below the fold on a phone.
          await page.screenshot({ path: path.join(OUT, file), fullPage: shot.fullPage ?? true });
          const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
          const words = shot.vocab || VOCAB.has(shot.name) ? await vocabulary(page) : [];
          manifest.shots.push({ file, route, width, ok: words.length === 0, textSample: bodyText.slice(0, 400), ...(words.length ? { cryptoWords: words } : {}) });
          console.log(words.length ? `FAIL - ${file}: crypto words outside Payment details: ${words.join(" | ")}` : `ok - ${file}`);
        } catch (err) {
          manifest.shots.push({ file, width, ok: false, error: String(err?.message ?? err) });
          console.log(`FAIL - ${file}: ${err?.message ?? err}`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const failed = manifest.shots.filter((s) => !s.ok).length;
  console.log(`${manifest.shots.length - failed}/${manifest.shots.length} screenshots in ${OUT}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
