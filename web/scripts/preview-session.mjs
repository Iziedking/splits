// A signed-in person on a preview server (SPLITS_MODE=preview), for the evidence scripts
// (screenshots.mjs, keyboard-pass.mjs). Signs in through the real email-code flow, sets the PIN, adds
// preview money and makes one saved split. Each email is a separate person.
export const PIN = "482913";

/** Plain HTTP calls that keep the session cookie. */
export function previewClient(base) {
  let cookie = "";
  async function call(method, route, body) {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: { "content-type": "application/json", origin: base, ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  return { call, cookie: () => cookie };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A Split tag from the email (every test email is unique, so the tag is too). */
export const tagFor = (email) => email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20).padEnd(3, "_");

/** `tag: null` leaves the account without one, to show the tag step. */
export async function previewSession(base, email = "ada@example.com", { tag = tagFor(email) } = {}) {
  const { call, cookie } = previewClient(base);
  const start = await call("POST", "/api/auth/start", { email });
  if (start.status !== 200) throw new Error(`auth start ${start.status}: ${JSON.stringify(start.data)}`);
  const verify = await call("POST", "/api/auth/verify", { email, code: start.data.previewCode });
  if (verify.status !== 200) throw new Error(`auth verify ${verify.status}`);
  const pin = await call("POST", "/api/security/pin", { pin: PIN });
  if (pin.status !== 200) throw new Error(`pin ${pin.status}: ${JSON.stringify(pin.data)}`);
  const [name, value] = cookie().split("=");
  // Without a tag the account is still at /setup: it can't hold money or make a split yet.
  if (!tag) return { call, splitId: null, cookie: { name, value }, tag };
  const claimed = await call("POST", "/api/tags", { tag });
  if (claimed.status !== 200) throw new Error(`tag ${claimed.status}: ${JSON.stringify(claimed.data)}`);

  // Preview-only: money arrives as if sent from another chain, so Home and Pay show a balance.
  const deposit = await call("POST", "/api/demo/deposit", { chain: "base", amount: "60" });
  if (deposit.status >= 300) console.log(`note: demo deposit refused (${deposit.status}); balance stays at 0.00`);
  for (let i = 0; i < 40; i++) {
    const me = await call("GET", "/api/me");
    if (me.data?.wallets?.find((w) => w.kind === "main")?.balance !== "0.00") break;
    await wait(500);
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
    await wait(300);
    split = (await call("GET", `/api/splits/${split.id}`)).data.split;
  }
  return { call, splitId: split.id, cookie: { name, value }, tag };
}

/** Pays three people from the balance and waits for it to settle; returns the payment id. */
export async function settledPayment(call) {
  const check = await call("POST", "/api/payouts/check", {
    mode: "each",
    text: "landlord@example.com, 3, rent\nschool@example.com, 2, school fees\nsister@example.com, 1, upkeep",
    label: "family",
  });
  if (check.status !== 200 || !check.data.ready) throw new Error(`check ${check.status}: ${JSON.stringify(check.data)}`);
  const quote = await call("POST", "/api/transfers", { draftId: check.data.draft.id, draftHash: check.data.draft.hash, fundWith: "balance" });
  if (quote.status !== 201) throw new Error(`transfer ${quote.status}: ${JSON.stringify(quote.data)}`);
  const paid = await call("POST", "/api/transfers/confirm", { actionId: quote.data.action.id, pin: PIN });
  let t = paid.data.transfer;
  for (let i = 0; i < 40 && !["settled", "failed"].includes(t.status); i++) {
    await wait(300);
    t = (await call("GET", `/api/transfers/${t.id}`)).data.transfer;
  }
  if (t.status !== "settled") throw new Error(`payment ${t.status}`);
  return t.id;
}
