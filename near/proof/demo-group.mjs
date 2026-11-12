// Creates a demo group fund on the LIVE router, splits.kingizie.testnet, so the hosted demo has a
// real group to open: a two-member Sputnik DAO that voted its split into the router, with every
// recipient able to hold Circle's testnet USDC. Anyone can then pay the group from its pay link and
// watch the payment divide by the rule the group voted on. No wallet and no keys of yours: every
// account comes from the public testnet faucet, and its key lives only in this process.
//
//   cd near/proof && npm ci && node demo-group.mjs
import { randomBytes } from "node:crypto";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from "near-api-js";

const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const FAUCET = "https://helper.nearprotocol.com/account";
const EXPLORER = "https://testnet.nearblocks.io";
const ROUTER = process.env.LIVE_ROUTER ?? "splits.kingizie.testnet";
const USDC = process.env.USDC ?? "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af"; // Circle's testnet USDC
const FACTORY = process.env.DAO_FACTORY ?? "sputnikv2.testnet";
const SITE = process.env.SITE ?? "https://near.mysplits.xyz";

const TGAS = 10n ** 12n;
const NEAR = 10n ** 24n;
const STORAGE = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR, one USDC registration
const provider = new JsonRpcProvider({ url: RPC });
const link = (hash) => `${EXPLORER}/txns/${hash}`;
const call = (method, args, deposit = 0n, gas = 50n) => actions.functionCall(method, args, gas * TGAS, deposit);

async function view(contract, method, args = {}) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "demo",
      method: "query",
      params: { finality: "final", request_type: "call_function", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error.cause ?? body.error).slice(0, 300)}`);
  return JSON.parse(Buffer.from(body.result.result).toString() || "null");
}

async function faucetAccount(keyPair, label) {
  const id = `splits-${label}-${Date.now().toString(36)}${randomBytes(2).toString("hex")}.testnet`;
  const res = await fetch(FAUCET, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: keyPair.getPublicKey().toString() }) });
  if (!res.ok) throw new Error(`The testnet faucet answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  for (let i = 0; i < 20; i++) {
    const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "demo", method: "query", params: { finality: "final", request_type: "view_account", account_id: id } }) });
    if (!(await r.json()).error) return id;
    await new Promise((s) => setTimeout(s, 1000));
  }
  throw new Error(`The faucet did not create ${id}`);
}

async function send(account, receiverId, acts) {
  const out = await account.signAndSendTransaction({ receiverId, actions: acts, waitUntil: "FINAL", throwOnFailure: false });
  const hash = out.transaction_outcome?.id ?? out.transaction?.hash;
  const failure = [out.status, ...(out.receipts_outcome ?? []).map((r) => r.outcome.status)].find((s) => s && s.Failure);
  if (failure) throw new Error(`Transaction ${hash} failed: ${JSON.stringify(failure.Failure).slice(0, 300)}`);
  return hash;
}

async function main() {
  console.log(`Demo group fund on ${ROUTER}`);
  const keyPair = KeyPair.fromRandom("ed25519");
  const signer = new KeyPairSigner(keyPair);
  const acct = (id) => new Account(id, provider, signer);

  // One faucet account (the faucet allows few per address); the flatmates and landlord are its subaccounts.
  const ada = await faucetAccount(keyPair, "flat");
  const bo = `bo.${ada}`;
  const landlord = `landlord.${ada}`;
  for (const sub of [bo, landlord]) {
    await send(acct(ada), sub, [actions.createAccount(), actions.transfer(NEAR / 2n), actions.addFullAccessKey(keyPair.getPublicKey())]);
  }
  console.log(`Members ${ada} and ${bo}; landlord ${landlord}`);

  // Everyone the group pays must be able to hold USDC, or that part would return to the payer.
  for (const who of [ada, bo, landlord]) {
    if ((await view(USDC, "storage_balance_of", { account_id: who })) === null) await send(acct(ada), USDC, [call("storage_deposit", { account_id: who, registration_only: true }, STORAGE, 10n)]);
  }

  const name = `flat-${randomBytes(3).toString("hex")}`;
  const dao = `${name}.${FACTORY}`;
  const args = { config: { name, purpose: "Our flat: rent, bills and the summer trip", metadata: "" }, policy: [ada, bo] };
  let h = await send(acct(ada), FACTORY, [call("create", { name, args: Buffer.from(JSON.stringify(args)).toString("base64") }, NEAR * 6n, 150n)]);
  console.log(`Created the group ${dao}  ${link(h)}`);

  const shares = [
    { account_id: landlord, bps: 4000, purpose: "rent" },
    { account_id: bo, bps: 3000, purpose: "bills" },
    { account_id: ada, bps: 3000, purpose: "trip fund" },
  ];
  const kind = {
    FunctionCall: {
      receiver_id: ROUTER,
      actions: [{ method_name: "set_split", args: Buffer.from(JSON.stringify({ shares })).toString("base64"), deposit: String(10n ** 22n), gas: String(50n * TGAS) }],
    },
  };
  const policy = await view(dao, "get_policy");
  h = await send(acct(ada), dao, [call("add_proposal", { proposal: { description: "Splits: divide the flat's money 40% rent, 30% bills, 30% trip fund", kind } }, BigInt(policy.proposal_bond), 50n)]);
  const id = (await view(dao, "get_last_proposal_id")) - 1;
  console.log(`${ada} proposed the split  ${link(h)}`);
  for (const voter of [ada, bo]) {
    h = await send(acct(voter), dao, [call("act_proposal", { id, action: "VoteApprove", proposal: kind }, 0n, 200n)]);
    console.log(`${voter} voted yes  ${link(h)}`);
  }

  const proposal = await view(dao, "get_proposal", { id });
  const split = await view(ROUTER, "get_split", { account_id: dao });
  if (proposal.status !== "Approved" || !split) throw new Error(`The vote did not save the split (proposal ${proposal.status})`);
  console.log(`\nThe group's split, version ${split.version}: 40% rent, 30% bills, 30% trip fund.`);
  console.log(`Open it:  ${SITE}/near/group?dao=${dao}`);
  console.log(`Pay it:   ${SITE}/near/pay/${dao}`);
}

main().catch((e) => {
  console.error(`\nStopped: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
