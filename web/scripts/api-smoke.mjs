// Starts the built app in preview mode and walks the whole user loop over real HTTP:
// sign in, set a PIN, create a split, confirm it, pay through it, and check the guards.
// Run from web/ after `next build`: node scripts/api-smoke.mjs
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const PORT = Number(process.env.SMOKE_PORT ?? 3917);
const ORIGIN = `http://localhost:${PORT}`;

// Next runs in its own process group so the whole group can be stopped at the end. Through npx,
// SIGTERM reached only npx and left next-server holding this script's pipes, so it never exited.
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
  env: { ...process.env, SPLITS_MODE: "preview", APP_URL: ORIGIN, SWEEP_INTERVAL_MS: "1000" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let logs = "";
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));

let cookie = "";
async function call(method, path, body, { origin = ORIGIN, withCookie = true } = {}) {
  const res = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
      ...(withCookie && cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${ORIGIN}/`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start:\n${logs}`);
}

const step = (name) => console.log(`ok - ${name}`);

try {
  await waitForServer();

  assert.equal((await call("GET", "/api/me", undefined, { withCookie: false })).status, 401);
  step("signed-out requests are refused");

  const start = await call("POST", "/api/auth/start", { email: "Ada@Example.com" });
  assert.equal(start.status, 200);
  assert.match(start.data.previewCode, /^\d{6}$/);
  const verify = await call("POST", "/api/auth/verify", { email: "ada@example.com", code: start.data.previewCode });
  assert.equal(verify.status, 200, JSON.stringify(verify.data));
  assert.match(cookie, /^splits_session=/);
  step("email sign-in sets a session and creates the wallet");

  const crossSite = await call("POST", "/api/security/pin", { pin: "482913" }, { origin: "https://evil.example" });
  assert.equal(crossSite.status, 403);
  step("cross-site writes are blocked");

  assert.equal((await call("POST", "/api/security/pin", { pin: "123456" })).data.error.code, "PIN_TOO_SIMPLE");
  assert.equal((await call("POST", "/api/security/pin", { pin: "482913" })).status, 200);
  step("PIN set, trivial PINs refused");

  const draft = await call("POST", "/api/splits", {
    name: "Family in Lagos",
    legs: [
      { name: "Landlord", to: { type: "email", email: "landlord@example.com" }, amount: { type: "percent", percent: 40 }, purpose: "rent" },
      { name: "School", to: { type: "email", email: "school@example.com" }, amount: { type: "percent", percent: 35 }, purpose: "school fees" },
      { name: "Sister", to: { type: "email", email: "sister@example.com" }, amount: { type: "percent", percent: 25 }, purpose: "upkeep" },
    ],
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.data));
  const wrong = await call("POST", "/api/splits/confirm", { actionId: draft.data.action.id, pin: "000001" });
  assert.equal(wrong.data.error.code, "PIN_WRONG");
  const confirmed = await call("POST", "/api/splits/confirm", { actionId: draft.data.action.id, pin: "482913" });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  let split = confirmed.data.split;
  for (let i = 0; i < 20 && split.status === "pending"; i++) {
    await new Promise((r) => setTimeout(r, 300));
    split = (await call("GET", `/api/splits/${split.id}`)).data.split;
  }
  assert.equal(split.status, "active");
  step("split confirmed with PIN and registered onchain (simulated)");

  const quote = await call("POST", "/api/transfers", { splitId: split.id, fundWith: "card", currency: "GBP", fiatMinor: 1000 });
  assert.equal(quote.status, 201, JSON.stringify(quote.data));
  assert.equal(quote.data.transfer.amount, "12.70");
  assert.deepEqual(quote.data.transfer.legs.map((l) => l.amount), ["5.08", "4.44", "3.18"]);
  // The Splits fee (1.5% by default) rides on top: recipients still get the full 12.70.
  assert.equal(quote.data.transfer.fee, "0.19");
  assert.equal(quote.data.transfer.total, "12.89");
  const pay = await call("POST", "/api/transfers/confirm", { actionId: quote.data.action.id, pin: "482913" });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  let transfer = pay.data.transfer;
  for (let i = 0; i < 30 && !["settled", "failed"].includes(transfer.status); i++) {
    await new Promise((r) => setTimeout(r, 300));
    transfer = (await call("GET", `/api/transfers/${transfer.id}`)).data.transfer;
  }
  assert.equal(transfer.status, "settled", JSON.stringify(transfer));
  assert.deepEqual(transfer.steps.map((s) => s.status), ["complete", "complete", "complete"]);
  step("£10 paid by (simulated) card, split 5.08 / 4.44 / 3.18 USDC and verified");

  const replay = await call("POST", "/api/transfers/confirm", { actionId: quote.data.action.id, pin: "482913" });
  assert.equal(replay.status, 409);
  step("replaying a confirmation is refused");

  const me = await call("GET", "/api/me");
  assert.equal(me.data.mode, "preview");
  assert.equal(me.data.wallets[0].balance, "0.00");
  step("sender's wallet shows the money has left");

  // A giveaway: 20 people, addresses and emails mixed, paid in one transaction. $10 keeps the day's
  // simulated card total (12.70 + 10) under the default $25 per-person cap.
  const lines = [
    ...Array.from({ length: 15 }, (_, i) => `0x${(0xcafe00 + i).toString(16).padStart(40, "0")}`),
    ...Array.from({ length: 5 }, (_, i) => `winner${i}@example.com`),
  ];
  const check = await call("POST", "/api/payouts/check", { mode: "equal", text: lines.join("\n"), pot: "10", label: "giveaway prize" });
  assert.equal(check.status, 200, JSON.stringify(check.data));
  assert.equal(check.data.ready, true, JSON.stringify(check.data.lines.filter((l) => l.status !== "ready")));
  assert.equal(check.data.lines.length, 20);
  assert.ok(check.data.lines.every((l) => l.amount === "0.50"));
  step("a 20-person giveaway list checks out at $0.50 each");

  const bad = await call("POST", "/api/payouts/check", { mode: "each", text: `${lines[0]}, 1\n${lines[0]}, 1`, label: "x" });
  assert.equal(bad.data.ready, false);
  assert.equal(bad.data.lines[1].status, "duplicate");
  step("a duplicate blocks a list");

  const giveawayBody = { draftId: check.data.draft.id, draftHash: check.data.draft.hash, fundWith: "card" };
  const giveawayQuote = await call("POST", "/api/transfers", giveawayBody);
  assert.equal(giveawayQuote.status, 201, JSON.stringify(giveawayQuote.data));
  const again = await call("POST", "/api/transfers", giveawayBody);
  assert.equal(again.data.error.code, "LIST_ALREADY_PAID");
  const giveawayPay = await call("POST", "/api/transfers/confirm", { actionId: giveawayQuote.data.action.id, pin: "482913" });
  assert.equal(giveawayPay.status, 200, JSON.stringify(giveawayPay.data));
  let giveaway = giveawayPay.data.transfer;
  for (let i = 0; i < 40 && !["settled", "failed"].includes(giveaway.status); i++) {
    await new Promise((r) => setTimeout(r, 300));
    giveaway = (await call("GET", `/api/transfers/${giveaway.id}`)).data.transfer;
  }
  assert.equal(giveaway.status, "settled", JSON.stringify(giveaway));
  assert.equal(giveaway.kind, "pay");
  assert.equal(giveaway.legs.length, 20);
  assert.equal(giveaway.fee, "0.20"); // 2% from 10 recipients
  step("the giveaway pays 20 people in one transaction, and a second click can't pay again");

  const activity = await call("GET", "/api/activity");
  assert.equal(activity.status, 200);
  assert.ok(activity.data.sent.some((t) => t.id === giveaway.id));
  assert.equal(activity.data.receivedError, null);
  step("activity lists the giveaway");

  assert.equal((await call("GET", "/api/cron/sweep")).status, 401);
  step("cron route needs its secret");

  // Visitors: config, a checked list, the limit, the status link without a cookie.
  const session = cookie;
  cookie = "";
  const cfg = await call("GET", "/api/visitor/config", undefined, { withCookie: false });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.data));
  assert.equal(cfg.data.limits.perPayment, "500.00");
  step("visitor config is public");

  const vcheck = await call("POST", "/api/visitor/check", { mode: "each", text: "0x00000000000000000000000000000000000000f1, 2", label: "gift" }, { withCookie: false });
  assert.equal(vcheck.status, 200, JSON.stringify(vcheck.data));
  assert.equal(vcheck.data.ready, true);
  assert.equal(vcheck.data.fee, "0.03");
  assert.equal(vcheck.data.charge, "2.03");
  step("a visitor can check a list, with the fee on top");

  const big = await call("POST", "/api/visitor/check", { mode: "each", text: "0x00000000000000000000000000000000000000f1, 501", label: "gift" }, { withCookie: false });
  assert.equal(big.status, 403, JSON.stringify(big.data));
  assert.equal(big.data.error.code, "SEND_LIMIT");
  step("a visitor list over 500 is refused");

  const missing = await call("GET", "/api/visitor/payments/xxxxxxxxxxxxxxxxxxxxxxxx", undefined, { withCookie: false });
  assert.equal(missing.status, 404);
  step("an unknown visitor payment link is a 404");

  const cross = await call("POST", "/api/visitor/check", { mode: "each", text: "x, 1", label: "gift" }, { origin: "https://evil.example", withCookie: false });
  assert.equal(cross.status, 403);
  step("visitor routes refuse cross-site posts");
  cookie = session;

  const signedIn = await call("POST", "/api/visitor/check", { mode: "each", text: "0x00000000000000000000000000000000000000f1, 1", label: "gift" });
  assert.equal(signedIn.status, 409, JSON.stringify(signedIn.data));
  assert.equal(signedIn.data.error.code, "SIGNED_IN");
  step("signed-in people are sent to their account's limits, not visitor ones");

  console.log("api smoke: all checks passed");
} catch (err) {
  console.error(err);
  console.error("--- server log ---\n" + logs.slice(-4000));
  process.exitCode = 1;
} finally {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
  server.stdout.destroy();
  server.stderr.destroy();
}
