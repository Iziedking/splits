// One-time Circle setup for a Splits environment. Run it yourself, from web/, on the server:
//
//   node scripts/circle-setup.mjs ~/splits-ops/testnet.env
//
// The env file must already contain CIRCLE_API_KEY. The script fills in whatever is missing,
// in order, and never prints a secret:
//   1. CIRCLE_ENTITY_SECRET  a new 32-byte secret, registered with Circle. The recovery file is
//                            saved next to the env file. Back both up somewhere safe.
//   2. CIRCLE_WALLET_SET_ID  a wallet set for this environment
//   3. CIRCLE_TREASURY_WALLET_ID  an SCA wallet that funds simulated card top-ups and deploys
//                                 the router
// Running it again is safe: steps that are already done are skipped.
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";

const envPath = process.argv[2];
if (!envPath) {
  console.error("Usage: node scripts/circle-setup.mjs <path to env file>");
  process.exit(1);
}

function readEnv() {
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function save(key, value) {
  appendFileSync(envPath, `${key}=${value}\n`);
  chmodSync(envPath, 0o600);
}

let env = readEnv();
if (!env.CIRCLE_API_KEY) {
  console.error(`CIRCLE_API_KEY is missing from ${envPath}`);
  process.exit(1);
}
const blockchain = env.CIRCLE_BLOCKCHAIN ?? "ARC-TESTNET";
const label = blockchain === "ARC" ? "mainnet" : "testnet";
if (blockchain === "ARC" && !env.CIRCLE_API_KEY.startsWith("LIVE_API_KEY")) {
  console.error("CIRCLE_BLOCKCHAIN=ARC needs a LIVE_API_KEY. Refusing to continue.");
  process.exit(1);
}

if (!env.CIRCLE_ENTITY_SECRET) {
  const entitySecret = randomBytes(32).toString("hex");
  const dir = path.dirname(path.resolve(envPath));
  await registerEntitySecretCiphertext({
    apiKey: env.CIRCLE_API_KEY,
    entitySecret,
    recoveryFileDownloadPath: dir,
  });
  save("CIRCLE_ENTITY_SECRET", entitySecret);
  console.log(`1. Entity secret registered and saved to ${envPath}.`);
  console.log(`   Circle's recovery file is in ${dir}. Back up the env file and the recovery file now.`);
} else {
  console.log("1. Entity secret already set, skipping.");
}

env = readEnv();
const client = initiateDeveloperControlledWalletsClient({
  apiKey: env.CIRCLE_API_KEY,
  entitySecret: env.CIRCLE_ENTITY_SECRET,
});

if (!env.CIRCLE_WALLET_SET_ID) {
  const res = await client.createWalletSet({ name: `Splits ${label}` });
  const id = res.data?.walletSet?.id;
  if (!id) throw new Error("Circle returned no wallet set");
  save("CIRCLE_WALLET_SET_ID", id);
  console.log(`2. Wallet set created: ${id}`);
} else {
  console.log("2. Wallet set already set, skipping.");
}

env = readEnv();
if (!env.CIRCLE_TREASURY_WALLET_ID) {
  const res = await client.createWallets({
    walletSetId: env.CIRCLE_WALLET_SET_ID,
    blockchains: [blockchain],
    accountType: "SCA",
    count: 1,
    metadata: [{ name: "Splits treasury", refId: "treasury" }],
  });
  const wallet = res.data?.wallets?.[0];
  if (!wallet?.id) throw new Error("Circle returned no wallet");
  save("CIRCLE_TREASURY_WALLET_ID", wallet.id);
  console.log(`3. Treasury wallet created: ${wallet.id}`);
  console.log(`   Address: ${wallet.address}`);
} else {
  const res = await client.getWallet({ id: env.CIRCLE_TREASURY_WALLET_ID });
  console.log(`3. Treasury wallet already set: ${env.CIRCLE_TREASURY_WALLET_ID}`);
  console.log(`   Address: ${res.data?.wallet?.address}`);
}

console.log(
  label === "testnet"
    ? "\nNext: at https://faucet.circle.com, pick Arc Testnet and send USDC to the treasury address above."
    : "\nNext: fund the treasury wallet address above with USDC on Arc mainnet.",
);
