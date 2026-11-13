// Creates the app account that runs email sign-in on NEAR testnet: it creates each person's account,
// pays their fees (the relayer) and holds the test money. Run it once, on your own machine:
//
//   node near/app-account.mjs > splits-near.env
//
// It prints three lines for /opt/splits/prod.env. They are secrets: whoever holds them can sign for
// every email account. Copy them to the server, then delete the file:
//
//   cat splits-near.env | ssh host-services 'sudo tee -a /opt/splits/prod.env > /dev/null'
//   rm splits-near.env
//
// No dependencies: Node's own crypto makes the keys, and the public testnet faucet makes the account
// with 10 test NEAR. Pass a name to choose it (default splits-app.testnet).
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";

const NAME = process.argv[2] ?? "splits-app.testnet";
const RPC = "https://test.rpc.fastnear.com";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

async function exists(id) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", request_type: "view_account", account_id: id } }) });
  return !(await r.json()).error;
}

if (await exists(NAME)) {
  console.error(`${NAME} already exists. Pick another name: node near/app-account.mjs my-name.testnet`);
  process.exit(1);
}

const { privateKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
const pub = createPublicKey(createPrivateKey({ key: privateKey.export({ format: "der", type: "pkcs8" }), format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }).subarray(-32);
const publicKey = `ed25519:${base58(pub)}`;

const res = await fetch("https://helper.nearprotocol.com/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: NAME, newAccountPublicKey: publicKey }) });
if (!res.ok) {
  console.error(`The testnet faucet answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
for (let i = 0; i < 20 && !(await exists(NAME)); i++) await new Promise((r) => setTimeout(r, 1000));
if (!(await exists(NAME))) {
  console.error(`The faucet did not create ${NAME}. Try again in a minute.`);
  process.exit(1);
}

console.error(`Created ${NAME} with 10 test NEAR: https://testnet.nearblocks.io/address/${NAME}`);
console.error(`Next: send it test USDC from https://faucet.circle.com (choose NEAR Testnet, address ${NAME}).`);
console.log(`NEAR_APP_ACCOUNT=${NAME}`);
console.log(`NEAR_APP_KEY=ed25519:${base58(Buffer.concat([seed, pub]))}`);
console.log(`NEAR_KEYS_SECRET=${randomBytes(32).toString("hex")}`);
