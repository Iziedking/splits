// Creates the demo shop's three payees on NEAR testnet (web/src/lib/near/demo-shop.ts): the farm, the
// tax pot and the staff tip jar. Each comes from the public faucet and registers itself for
// Circle's testnet USDC, so every sale at near.mysplits.xyz/shop lands. Their keys exist only in
// this process, so nobody can move what they receive: it stays as the record of each sale.
// Running it again skips accounts that already exist.
//
//   cd near/proof && npm ci && node demo-shop-accounts.mjs
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from "near-api-js";

const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const FAUCET = "https://helper.nearprotocol.com/account";
const USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const NAMES = ["splits-demo-farm.testnet", "splits-demo-taxpot.testnet", "splits-demo-tipjar.testnet"];
const STORAGE = 1_250_000_000_000_000_000_000n;

async function query(params) {
  const res = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "shop", method: "query", params: { finality: "final", ...params } }) });
  return res.json();
}
const exists = async (id) => !(await query({ request_type: "view_account", account_id: id })).error;
async function registered(id) {
  const r = await query({ request_type: "call_function", account_id: USDC, method_name: "storage_balance_of", args_base64: Buffer.from(JSON.stringify({ account_id: id })).toString("base64") });
  return JSON.parse(Buffer.from(r.result.result).toString() || "null") !== null;
}

for (const id of NAMES) {
  if (await exists(id)) {
    console.log(`${id} exists; USDC registered: ${await registered(id)}`);
    continue;
  }
  const keyPair = KeyPair.fromRandom("ed25519");
  const res = await fetch(FAUCET, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: keyPair.getPublicKey().toString() }) });
  if (!res.ok) throw new Error(`The faucet answered ${res.status} for ${id}: ${(await res.text()).slice(0, 200)}`);
  for (let i = 0; i < 20 && !(await exists(id)); i++) await new Promise((r) => setTimeout(r, 1000));
  const account = new Account(id, new JsonRpcProvider({ url: RPC }), new KeyPairSigner(keyPair));
  const out = await account.signAndSendTransaction({
    receiverId: USDC,
    actions: [actions.functionCall("storage_deposit", { account_id: id, registration_only: true }, 30n * 10n ** 12n, STORAGE)],
    waitUntil: "FINAL",
  });
  console.log(`${id} created and registered for USDC  https://testnet.nearblocks.io/txns/${out.transaction_outcome?.id ?? out.transaction?.hash}`);
}
