// One-off, already run: publishes the TEST DOLLAR code where testnet-proof.mjs downloads it.
//
//   node publish-token-code.mjs <path to test_token.wasm> [account, default splits-test-dollar.testnet]
//
// Creates the account from the public testnet faucet, deploys the code (no init: the account is
// only a code holder), then deletes the account's only key so the code can never change. Anyone
// can compare its code hash with their own build of near/test-token.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from "near-api-js";

const [wasmPath, accountId = "splits-test-dollar.testnet"] = process.argv.slice(2);
if (!wasmPath) throw new Error("Give the path to test_token.wasm");
const wasm = readFileSync(wasmPath);
const keyPair = KeyPair.fromRandom("ed25519");

const res = await fetch("https://helper.nearprotocol.com/account", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: keyPair.getPublicKey().toString() }),
});
if (!res.ok) throw new Error(`Faucet answered ${res.status}: ${await res.text()}`);
await new Promise((r) => setTimeout(r, 3000));

const account = new Account(accountId, new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" }), new KeyPairSigner(keyPair));
const out = await account.signAndSendTransaction({
  receiverId: accountId,
  actions: [actions.deployContract(new Uint8Array(wasm)), actions.deleteKey(keyPair.getPublicKey())],
  waitUntil: "FINAL",
});
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let n = BigInt("0x" + createHash("sha256").update(wasm).digest("hex"));
let hash = "";
while (n > 0n) (hash = B58[Number(n % 58n)] + hash), (n /= 58n);
console.log(`Deployed ${wasm.length} bytes to ${accountId}, code hash ${hash}, key deleted`);
console.log(`https://testnet.nearblocks.io/txns/${out.transaction_outcome.id}`);
