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
  await page.getByLabel("Email", { exact: true }).fill("landlord@example.com");
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
  // WP9a: the landing's pinned scene mid-way, with motion on (the other shots use reduced motion).
  {
    name: "landing-motion",
    path: "/",
    signedIn: false,
    motion: true,
    fullPage: false,
    act: async (p) => {
      await p.evaluate(() => window.scrollTo(0, window.innerHeight * 0.9));
      await p.waitForTimeout(900);
    },
  },
  // WP7: Help (with a payment's reference), Terms and Privacy, signed out and in.
  { name: "help", path: "/help", signedIn: false, vocab: true },
  { name: "help-with-ref", path: (c) => `/help?ref=${c.paymentId.replace(/-/g, "").slice(0, 12).toUpperCase()}`, vocab: true },
  { name: "terms", path: "/legal/terms", signedIn: false, vocab: true },
  { name: "privacy", path: "/legal/privacy", vocab: true },
  // Support agent: an answer, an action line, and the hand-over, all checked for crypto words.
  { name: "chat-answer", path: "/help", act: (p) => chatSay(p, "What happened to my last payment?"), fullPage: false, vocab: true },
  { name: "chat-action", path: (c) => `/help?ref=${c.paymentId.replace(/-/g, "").slice(0, 12).toUpperCase()}`, act: (p) => chatSay(p, "Send my receipt again"), fullPage: false, vocab: true },
  {
    name: "chat-handed-over",
    path: "/help",
    act: async (p) => {
      await openSheet(p, "Chat with us");
      await p.getByRole("button", { name: "Talk to a person" }).click();
      await p.getByText("within 24 hours").waitFor();
    },
    fullPage: false,
    vocab: true,
  },
  // WP6: the rest of the signed-in screens, also checked for crypto words.
  { name: "split-new", path: "/splits/new", vocab: true },
  { name: "rule-new", path: "/rules/new", vocab: true },
];

/** Shots on the consumer path, checked for crypto vocabulary. */
const VOCAB = new Set(["signin", "home", "pay", "pay-many", "pay-review-mainnet", "send-split-mainnet", "profile", "settings", "history", "earn", "sheet-add-money", "sheet-notifications"]);
const FORBIDDEN = /\bArc\b|USDC|0x[0-9a-fA-F]|\bEVM\b|explorer|transaction/i;

/** Pages whose measured contrast fails the run (WP9a). Every other page records its result only. */
const CONTRAST_GATE = new Set(["landing", "landing-motion"]);

/**
 * Text contrast as the browser paints it: each visible text's computed colour against its
 * background, composited up the ancestors to the first opaque one (gradients and images stop the
 * walk, and that text is counted as not measurable). WCAG AA: 4.5:1, or 3:1 for large text.
 * Disabled controls are exempt, as WCAG allows.
 */
async function contrast(page) {
  return page.evaluate(() => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = "1"] = m[1].split(/[ ,/]+/).filter(Boolean);
      return [Number(r), Number(g), Number(b), Number(a)];
    };
    const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3])).concat(1);
    const lum = (c) => {
      const [r, g, b] = c.slice(0, 3).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const page = parse(getComputedStyle(document.body).backgroundColor) ?? [243, 247, 248, 1];
    const background = (el) => {
      const layers = [];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.backgroundImage !== "none" && n !== document.body && n !== document.documentElement) return null;
        const c = parse(s.backgroundColor);
        if (c && c[3] > 0) {
          layers.push(c);
          if (c[3] >= 1) break;
        }
      }
      return layers.reverse().reduce((acc, c) => over(c, acc), page.concat(1));
    };
    const fails = [];
    let checked = 0;
    let skipped = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement;
      if (!el || !t.textContent.trim() || el.closest("[aria-hidden='true'], .sr-only, :disabled, [aria-disabled='true'], script, style")) continue;
      const rect = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (!rect.width || !rect.height || s.visibility === "hidden" || Number(s.opacity) === 0) continue;
      const bg = background(el);
      if (!bg) {
        skipped++;
        continue;
      }
      const fg = over(parse(s.color), bg);
      const size = parseFloat(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
      const need = large ? 3 : 4.5;
      const r = ratio(fg, bg);
      checked++;
      if (r < need) fails.push(`${r.toFixed(2)} < ${need}: "${t.textContent.trim().slice(0, 50)}" ${s.color} on rgb(${bg.slice(0, 3).map(Math.round).join(",")})`);
    }
    return { checked, skipped, fails: [...new Set(fails)] };
  });
}

/** Whether the page scrolls sideways (it must not, at any width). */
const overflowsX = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

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

/** Opens the support chat, sends one message and waits for the agent's answer. */
async function chatSay(page, text) {
  await openSheet(page, "Chat with us");
  await page.getByLabel("Your message").fill(text);
  await page.keyboard.press("Enter");
  await page.locator('[role="log"] li').nth(1).waitFor();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const session = await previewSession(BASE, `ada.${Date.now()}@example.com`);
  const paymentId = await settledPayment(session.call);
  const receipt = (await session.call("GET", `/api/transfers/${paymentId}`)).data.transfer.legs[0].receipt;
  const ctx = { ...session, paymentId, receipt };
  const browser = await chromium.launch();
  const manifest = { base: BASE, at: new Date().toISOString(), widths: WIDTHS, shots: [] };
  try {
    for (const width of WIDTHS) {
      for (const shot of SHOTS) {
        const file = `${shot.name}-${width}.png`;
        const context = await browser.newContext({
          viewport: { width, height: width < 768 ? 812 : 800 },
          deviceScaleFactor: 1,
          reducedMotion: shot.motion ? "no-preference" : "reduce",
        });
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
          const measured = await contrast(page);
          const sideways = await overflowsX(page);
          const problems = [
            ...(words.length ? [`crypto words outside Payment details: ${words.join(" | ")}`] : []),
            ...(CONTRAST_GATE.has(shot.name) && measured.fails.length ? [`contrast: ${measured.fails.join(" | ")}`] : []),
            ...(sideways ? ["scrolls sideways"] : []),
          ];
          manifest.shots.push({
            file,
            route,
            width,
            ok: problems.length === 0,
            textSample: bodyText.slice(0, 400),
            contrast: measured,
            ...(words.length ? { cryptoWords: words } : {}),
            ...(sideways ? { scrollsSideways: true } : {}),
          });
          console.log(problems.length ? `FAIL - ${file}: ${problems.join("; ")}` : `ok - ${file}`);
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
