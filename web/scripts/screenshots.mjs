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
//   node scripts/screenshots.mjs --base http://127.0.0.1:3918 --out ../evidence --widths 375,1280
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const BASE = args.base ?? "http://127.0.0.1:3918";
const OUT = path.resolve(args.out ?? "../evidence");
const WIDTHS = (args.widths ?? "375,1280").split(",").map(Number);
const PIN = "482913";

let cookie = "";
async function call(method, route, body) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** Signs in, sets the PIN, adds preview money and makes one saved split. Returns what the shots need. */
async function prepare() {
  const start = await call("POST", "/api/auth/start", { email: "ada@example.com" });
  if (start.status !== 200) throw new Error(`auth start ${start.status}: ${JSON.stringify(start.data)}`);
  const verify = await call("POST", "/api/auth/verify", { email: "ada@example.com", code: start.data.previewCode });
  if (verify.status !== 200) throw new Error(`auth verify ${verify.status}`);
  const pin = await call("POST", "/api/security/pin", { pin: PIN });
  if (pin.status !== 200) throw new Error(`pin ${pin.status}: ${JSON.stringify(pin.data)}`);

  // Preview-only: money arrives as if sent from another chain, so Home and Pay show a balance.
  const deposit = await call("POST", "/api/demo/deposit", { chain: "base", amount: "60" });
  if (deposit.status >= 300) console.log(`note: demo deposit refused (${deposit.status}); balance stays at 0.00`);
  for (let i = 0; i < 40; i++) {
    const me = await call("GET", "/api/me");
    if (me.data?.wallets?.find((w) => w.kind === "main")?.balance !== "0.00") break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const draft = await call("POST", "/api/splits", {
    name: "Family in Lagos",
    legs: [
      { name: "Landlord", to: { type: "email", email: "landlord@example.com" }, amount: { type: "percent", percent: 40 }, purpose: "rent" },
      { name: "School", to: { type: "email", email: "school@example.com" }, amount: { type: "percent", percent: 35 }, purpose: "school fees" },
      { name: "Sister", to: { type: "email", email: "sister@example.com" }, amount: { type: "percent", percent: 25 }, purpose: "upkeep" },
    ],
  });
  if (draft.status !== 201) throw new Error(`split ${draft.status}: ${JSON.stringify(draft.data)}`);
  const confirmed = await call("POST", "/api/splits/confirm", { actionId: draft.data.action.id, pin: PIN });
  let split = confirmed.data.split;
  for (let i = 0; i < 30 && split.status === "pending"; i++) {
    await new Promise((r) => setTimeout(r, 300));
    split = (await call("GET", `/api/splits/${split.id}`)).data.split;
  }
  const [name, value] = cookie.split("=");
  return { splitId: split.id, cookie: { name, value } };
}

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
  await page.getByLabel("Email or Arc address").fill("landlord@example.com");
  await page.getByLabel("Amount (USDC)").fill("25");
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
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const ctx = await prepare();
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
          manifest.shots.push({ file, route, width, ok: true, textSample: bodyText.slice(0, 400) });
          console.log(`ok - ${file}`);
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
