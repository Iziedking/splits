// Proof 2 of 2: Splits on NEAR testnet, from a terminal, with no wallet and no keys of yours.
//
//   cd near/proof && npm ci && node testnet-proof.mjs
//
// Each run starts from nothing:
//   1. Creates a fresh account from the public testnet faucet (10 test NEAR).
//   2. Downloads the code of the live router, splits.kingizie.testnet, checks it against the hash
//      NEAR stores for that account, and deploys that exact code to its own router.
//   3. Deploys TEST DOLLAR (a test token, no value) from splits-test-dollar.testnet the same way,
//      so it can mint its own money. The live router only accepts Circle's testnet USDC, which a
//      script cannot mint.
//   4. Proves, printing an explorer link for every step:
//      a. a split payment: one approval, each part lands with its purpose;
//      b. the same payment again with the same reference: refused, nothing moves, money returned;
//      c. a part to an account that cannot hold the token comes back; the others still land;
//      d. "auto-split my income into tax, savings and spending": ada saves a split once, then a
//         payment sent to her divides itself on arrival;
//      e. a payer who saw an older version of ada's split is refused and refunded.
// Exits non-zero if any check fails. Takes about two minutes.

import { createHash, randomBytes } from "node:crypto";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from "near-api-js";

// rpc.testnet.near.org is deprecated and rate limited; FastNEAR is one of the providers docs.near.org lists.
const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const FAUCET = "https://helper.nearprotocol.com/account";
const EXPLORER = "https://testnet.nearblocks.io";
const LIVE_ROUTER = process.env.LIVE_ROUTER ?? "splits.kingizie.testnet";
const TOKEN_CODE = process.env.TOKEN_CODE ?? "splits-test-dollar.testnet";

// near-api-js only signs and sends; every read below uses plain JSON-RPC.
const RPC_PROVIDER = new JsonRpcProvider({ url: RPC });

const TGAS = 10n ** 12n;
const NEAR = 10n ** 24n;
const milliNear = (m) => (NEAR * BigInt(m)) / 1000n;
const STORAGE = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR, one token registration
const USD = (s) => BigInt(Math.round(Number(s) * 1e6)); // TEST DOLLAR has 6 decimals
const fmt = (u) => (Number(BigInt(u)) / 1e6).toFixed(2);

let failures = 0;
const ok = (cond, text) => {
  console.log(`   ${cond ? "PASS" : "FAIL"}  ${text}`);
  if (!cond) failures++;
};
const step = (title) => console.log(`\n${title}`);
const link = (hash) => `${EXPLORER}/txns/${hash}`;

// ------------------------------------------------------------------ plain JSON-RPC

async function rpc(method, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "proof", method, params }) });
      const body = await res.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error.cause ?? body.error).slice(0, 300)}`);
      return body.result;
    } catch (e) {
      if (attempt >= 4 || /UNKNOWN_ACCOUNT|does not exist|MethodNotFound|FunctionCallError/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

const query = (params) => rpc("query", { finality: "final", ...params });

async function view(contract, method, args = {}) {
  const r = await query({ request_type: "call_function", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString() || "null");
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(buf) {
  let n = BigInt("0x" + (Buffer.from(buf).toString("hex") || "0"));
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}

/** The contract code of an account, checked against the hash NEAR keeps for it. */
async function fetchCode(accountId) {
  const [code, acct] = await Promise.all([query({ request_type: "view_code", account_id: accountId }), query({ request_type: "view_account", account_id: accountId })]);
  const wasm = Buffer.from(code.code_base64, "base64");
  const hash = base58(createHash("sha256").update(wasm).digest());
  return { wasm, hash, onChainHash: acct.code_hash };
}

/** Every NEP-297 event the router logged in a transaction, after all its receipts ran. */
async function eventsOf(hash, sender, router) {
  const tx = await rpc("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });
  const out = [];
  for (const r of tx.receipts_outcome) {
    if (r.outcome.executor_id !== router) continue;
    for (const log of r.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      const e = JSON.parse(log.slice("EVENT_JSON:".length));
      if (e.standard === "splits") out.push(e);
    }
  }
  return out;
}

// ------------------------------------------------------------------ accounts

async function faucetAccount(keyPair) {
  const id = `splits-proof-${Date.now().toString(36)}${randomBytes(2).toString("hex")}.testnet`;
  const res = await fetch(FAUCET, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: keyPair.getPublicKey().toString() }) });
  if (!res.ok) throw new Error(`The testnet faucet answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  for (let i = 0; i < 20; i++) {
    try {
      await query({ request_type: "view_account", account_id: id });
      return id;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`The faucet did not create ${id}`);
}

async function send(account, receiverId, acts) {
  // A payment can fail one inner transfer on purpose (check 3c), so failures are judged here.
  const out = await account.signAndSendTransaction({ receiverId, actions: acts, waitUntil: "FINAL", throwOnFailure: false });
  const hash = out.transaction_outcome?.id ?? out.transaction?.hash;
  const failure = [out.status, ...(out.receipts_outcome ?? []).map((r) => r.outcome.status)].find((s) => s && s.Failure);
  if (failure && !acts.some((a) => a.functionCall?.methodName === "ft_transfer_call")) {
    throw new Error(`Transaction ${hash} failed: ${JSON.stringify(failure.Failure).slice(0, 300)}`);
  }
  return hash;
}

const call = (method, args, deposit = 0n, gas = 50n) => actions.functionCall(method, args, gas * TGAS, deposit);

async function main() {
  console.log("Splits on NEAR: testnet proof");
  console.log(`RPC ${RPC}`);

  step("1. The live router's code");
  const live = await fetchCode(LIVE_ROUTER);
  console.log(`   ${LIVE_ROUTER} code hash ${live.onChainHash} (${live.wasm.length} bytes)`);
  ok(live.hash === live.onChainHash, "the downloaded code matches the hash NEAR stores for the live router");
  const tokenCode = await fetchCode(TOKEN_CODE);
  ok(tokenCode.hash === tokenCode.onChainHash, `TEST DOLLAR code from ${TOKEN_CODE} matches its hash ${tokenCode.onChainHash}`);

  step("2. A fresh testnet account and its own router and token");
  const keyPair = KeyPair.fromRandom("ed25519");
  const signer = new KeyPairSigner(keyPair);
  const root = await faucetAccount(keyPair);
  console.log(`   Created ${root} with test NEAR from the public faucet`);
  const acct = (name) => new Account(name, RPC_PROVIDER, signer);
  const payer = acct(root);
  const sub = (n) => `${n}.${root}`;
  const [router, token, tax, savings, mum, ada, nobody] = ["router", "usd", "tax", "savings", "mum", "ada", "nobody"].map(sub);
  const pk = keyPair.getPublicKey();
  const newSub = (id, near, wasm) =>
    send(payer, id, [actions.createAccount(), actions.transfer(milliNear(near)), actions.addFullAccessKey(pk), ...(wasm ? [actions.deployContract(new Uint8Array(wasm))] : [])]);

  let h = await newSub(router, 2600, live.wasm);
  console.log(`   Deployed the live router's code to ${router}  ${link(h)}`);
  h = await send(acct(router), router, [call("new", { tokens: [token] })]);
  console.log(`   Router accepts only ${token}  ${link(h)}`);
  const routerAcct = await query({ request_type: "view_account", account_id: router });
  ok(routerAcct.code_hash === live.onChainHash, `${router} runs exactly the code of ${LIVE_ROUTER}`);

  h = await newSub(token, 2200, tokenCode.wasm);
  h = await send(acct(token), token, [call("new", { owner_id: root, total_supply: String(USD(1000)) })]);
  console.log(`   ${token}: 1,000.00 TEST DOLLAR minted to ${root}  ${link(h)}`);

  for (const id of [tax, savings, mum, ada, nobody]) await newSub(id, id === ada ? 300 : 120);
  console.log(`   Created ${[tax, savings, mum, ada, nobody].join(", ")}`);
  h = await send(
    payer,
    token,
    [router, tax, savings, mum, ada].map((id) => call("storage_deposit", { account_id: id, registration_only: true }, STORAGE, 10n)),
  );
  console.log(`   Registered the router and four people with the token (${nobody} is left unregistered on purpose)  ${link(h)}`);

  const bal = async (id) => BigInt(await view(token, "ft_balance_of", { account_id: id }));
  const balances = async () => Object.fromEntries(await Promise.all([root, router, tax, savings, mum, ada].map(async (id) => [id, await bal(id)])));
  const pay = (total, msg) => send(payer, token, [actions.functionCall("ft_transfer_call", { receiver_id: router, amount: String(total), msg: JSON.stringify(msg) }, 300n * TGAS, 1n)]);
  const leg = (account_id, amount, purpose) => ({ account_id, amount: String(USD(amount)), purpose });
  const diff = (a, b, id) => b[id] - a[id];

  step("3a. Pay a split: 3.00 to three people, one approval");
  let before = await balances();
  const ref1 = `proof-${randomBytes(4).toString("hex")}`;
  h = await pay(USD(3), { ref: ref1, legs: [leg(tax, "0.90", "tax"), leg(savings, "0.60", "savings"), leg(mum, "1.50", "upkeep for mum")] });
  console.log(`   ${link(h)}`);
  let ev = await eventsOf(h, root, router);
  let after = await balances();
  for (const [id, amt, purpose] of [[tax, "0.90", "tax"], [savings, "0.60", "savings"], [mum, "1.50", "upkeep for mum"]]) {
    const e = ev.find((x) => x.event === "leg_paid" && x.data[0].recipient === id);
    ok(diff(before, after, id) === USD(amt) && e?.data[0].purpose === purpose, `${id} received ${amt} for "${purpose}"`);
  }
  ok(diff(before, after, root) === -USD(3), `${root} paid exactly 3.00`);
  ok(after[router] === 0n, "the router holds nothing afterwards");

  step("3b. The same payment again, same reference");
  before = after;
  h = await pay(USD(3), { ref: ref1, legs: [leg(tax, "0.90", "tax"), leg(savings, "0.60", "savings"), leg(mum, "1.50", "upkeep for mum")] });
  console.log(`   ${link(h)}`);
  ev = await eventsOf(h, root, router);
  after = await balances();
  ok(ev.some((e) => e.event === "payment_refused" && e.data[0].reason === "ref_already_used"), "refused: ref_already_used");
  ok([root, tax, savings, mum, router].every((id) => diff(before, after, id) === 0n), "nothing moved: the token returned the whole 3.00 to the payer");

  step("3c. One part goes to an account that cannot hold the token");
  before = after;
  h = await pay(USD(2), { ref: `proof-${randomBytes(4).toString("hex")}`, legs: [leg(tax, "1.20", "tax"), leg(nobody, "0.80", "a typo in the list")] });
  console.log(`   ${link(h)}`);
  ev = await eventsOf(h, root, router);
  after = await balances();
  ok(diff(before, after, tax) === USD("1.20"), `${tax} received its 1.20`);
  ok(ev.some((e) => e.event === "leg_refunded" && e.data[0].recipient === nobody), `the 0.80 to ${nobody} was not delivered`);
  ok(diff(before, after, root) === -USD("1.20") && after[router] === 0n, "the payer got the 0.80 back; the router holds nothing");

  step('3d. "Auto-split my income into tax, savings and spending"');
  const shares = [
    { account_id: tax, bps: 3000, purpose: "tax" },
    { account_id: savings, bps: 2000, purpose: "savings" },
    { account_id: ada, bps: 5000, purpose: "spending" },
  ];
  h = await send(acct(ada), router, [call("set_split", { shares }, milliNear(10), 30n)]);
  console.log(`   ${ada} saved 30% tax, 20% savings, 50% spending  ${link(h)}`);
  const saved = await view(router, "get_split", { account_id: ada });
  ok(saved?.version === 1 && saved.shares.length === 3, "the split is stored on chain, version 1");
  before = await balances();
  h = await pay(USD(10), { ref: `proof-${randomBytes(4).toString("hex")}`, to: ada, version: 1 });
  console.log(`   ${root} pays ${ada} 10.00, naming only her  ${link(h)}`);
  after = await balances();
  ok(diff(before, after, tax) === USD(3) && diff(before, after, savings) === USD(2) && diff(before, after, ada) === USD(5), "it divided itself on arrival: 3.00 tax, 2.00 savings, 5.00 spending");
  ok(after[router] === 0n, "the router holds nothing afterwards");

  step("3e. A payer who saw an older version of her split");
  h = await send(acct(ada), router, [call("set_split", { shares: [{ account_id: ada, bps: 10000, purpose: "spending" }] }, milliNear(10), 30n)]);
  before = await balances();
  h = await pay(USD(1), { ref: `proof-${randomBytes(4).toString("hex")}`, to: ada, version: 1 });
  console.log(`   ${link(h)}`);
  ev = await eventsOf(h, root, router);
  after = await balances();
  ok(ev.some((e) => e.event === "payment_refused" && e.data[0].reason === "stale_split_version"), "refused: stale_split_version");
  ok(diff(before, after, root) === 0n, "the payer kept the 1.00");

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
  console.log(`Every account from this run is under ${root}; look it up at ${EXPLORER}/address/${root}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(`\nStopped: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
