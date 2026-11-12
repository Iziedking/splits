// Saves the code of the live testnet router, splits.kingizie.testnet, as splits_router.wasm, after
// checking it against the hash NEAR stores for that account. Deploying this file to mainnet gives
// mainnet exactly the code testnet-proof.mjs tests. No dependencies, Node 20 or newer.
//
//   node near/proof/fetch-router-wasm.mjs [out-file]
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const ROUTER = "splits.kingizie.testnet";
const OUT = process.argv[2] ?? "splits_router.wasm";

async function query(params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "splits", method: "query", params: { finality: "final", ...params } }),
  });
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

function base58(buf) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(`0x${buf.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

const [code, account] = await Promise.all([query({ request_type: "view_code", account_id: ROUTER }), query({ request_type: "view_account", account_id: ROUTER })]);
const wasm = Buffer.from(code.code_base64, "base64");
const hash = base58(createHash("sha256").update(wasm).digest());
if (hash !== account.code_hash) {
  console.error(`Hash mismatch: downloaded ${hash}, NEAR says ${account.code_hash}. Nothing saved.`);
  process.exit(1);
}
await writeFile(OUT, wasm);
console.log(`Saved ${OUT}: ${wasm.length} bytes, code hash ${hash}, the same code as ${ROUTER}.`);
