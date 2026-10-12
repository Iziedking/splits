// Ops probe for the any-chain deposit work. Prints only non-secret facts.
//   node scripts/probe-crosschain.mjs <env file>
// 1. Derives the treasury SCA onto an EVM testnet and compares addresses (one-address mode?).
// 2. Checks CCTP V2 testnet contracts on Base/Arb/OP Sepolia and Arc Testnet.
// 3. Reads the sandbox Iris fee quote for Base Sepolia -> Arc Testnet.
import { readFileSync } from "node:fs";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const env = Object.fromEntries(
  readFileSync(process.argv[2], "utf8").split("\n").map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]),
);
const client = initiateDeveloperControlledWalletsClient({ apiKey: env.CIRCLE_API_KEY, entitySecret: env.CIRCLE_ENTITY_SECRET });
const arc = (await client.getWallet({ id: env.CIRCLE_TREASURY_WALLET_ID })).data.wallet;
const out = { arc: { address: arc.address, accountType: arc.accountType, blockchain: arc.blockchain }, derived: {} };
for (const blockchain of ["BASE-SEPOLIA", "ARB-SEPOLIA"]) {
  try {
    const d = (await client.deriveWallet({ id: arc.id, blockchain, metadata: { name: "probe", refId: "probe:derive" } })).data.wallet;
    out.derived[blockchain] = { address: d.address, accountType: d.accountType, same: d.address.toLowerCase() === arc.address.toLowerCase() };
  } catch (err) {
    out.derived[blockchain] = { error: err?.response?.data?.message ?? err?.message ?? String(err) };
  }
}
const rpc = {
  "base-sepolia": "https://sepolia.base.org",
  "arb-sepolia": "https://sepolia-rollup.arbitrum.io/rpc",
  "op-sepolia": "https://sepolia.optimism.io",
  "arc-testnet": "https://rpc.testnet.arc.io",
};
const call = async (url, method, params) =>
  (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
out.contracts = {};
for (const [name, url] of Object.entries(rpc)) {
  const tm = await call(url, "eth_getCode", ["0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA", "latest"]);
  const mt = await call(url, "eth_getCode", ["0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275", "latest"]);
  const domain = await call(url, "eth_call", [{ to: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275", data: "0x8d3638f4" }, "latest"]);
  out.contracts[name] = { tokenMessenger: (tm?.length ?? 2) > 2, messageTransmitter: (mt?.length ?? 2) > 2, localDomain: domain ? parseInt(domain, 16) : null };
}
out.fees = await (await fetch("https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/6/26")).json().catch(() => "error");
console.log(JSON.stringify(out, null, 2));
