// Deploys SplitsRouter from the Circle treasury wallet through the CREATE2 factory Arc lists on
// both networks (0x4e59b44847b379578588920cA78FbF26c0B4956C). Same bytecode and salt give the same
// router address on testnet and mainnet, there is no raw deployer key, and Gas Station pays gas.
//
//   node scripts/deploy-router.mjs <env file> <path to SplitsRouter.json> <deployments dir>
//
// It checks the result onchain (code present, usdc() correct) before writing the deployment record.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import {
  concat,
  createPublicClient,
  encodeAbiParameters,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

const [envPath, artifactPath, outDir] = process.argv.slice(2);
if (!envPath || !artifactPath || !outDir) {
  console.error("Usage: node scripts/deploy-router.mjs <env file> <SplitsRouter.json> <deployments dir>");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const USDC = env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const SALT = keccak256(stringToHex("splits.router.v1"));
const blockchain = env.CIRCLE_BLOCKCHAIN ?? "ARC-TESTNET";
const chainId = Number(env.ARC_CHAIN_ID ?? (blockchain === "ARC" ? 5042 : 5042002));
const rpc = (env.ARC_RPC_URLS ?? "").split(",")[0];
if (!rpc) throw new Error("ARC_RPC_URLS is missing");

const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const initCode = concat([artifact.bytecode.object, encodeAbiParameters([{ type: "address" }], [USDC])]);
const predicted = getContractAddress({ opcode: "CREATE2", from: FACTORY, salt: SALT, bytecode: initCode });

const chain = createPublicClient({ transport: http(rpc) });
if ((await chain.getChainId()) !== chainId) throw new Error(`RPC is not chain ${chainId}`);
if (!(await chain.getCode({ address: FACTORY }))) throw new Error("CREATE2 factory not found on this chain");

let txHash = null;
const existing = await chain.getCode({ address: predicted });
if (existing && existing !== "0x") {
  console.log(`Router already deployed at ${predicted}`);
} else {
  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: env.CIRCLE_API_KEY,
    entitySecret: env.CIRCLE_ENTITY_SECRET,
  });
  const res = await circle.createContractExecutionTransaction({
    walletId: env.CIRCLE_TREASURY_WALLET_ID,
    contractAddress: FACTORY,
    callData: concat([SALT, initCode]),
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    refId: "deploy:splits-router:v1",
  });
  const id = res.data?.id;
  if (!id) throw new Error("Circle returned no transaction id");
  console.log(`Submitted deployment, Circle transaction ${id}`);
  const done = await circle.getTransaction({
    id,
    waitForState: "COMPLETE",
    pollingInterval: 2000,
    signal: AbortSignal.timeout(5 * 60_000),
  });
  txHash = done.data?.transaction?.txHash ?? null;
  console.log(`Deployment transaction ${txHash}`);
}

// Verify, don't trust the acknowledgement.
const code = await chain.getCode({ address: predicted });
if (!code || code === "0x") throw new Error(`No code at ${predicted} after deployment`);
const routerAbi = parseAbi(["function usdc() view returns (address)", "function CENT() view returns (uint256)", "function nextSplitId() view returns (uint256)"]);
const [usdc, cent, nextId] = await Promise.all([
  chain.readContract({ address: predicted, abi: routerAbi, functionName: "usdc" }),
  chain.readContract({ address: predicted, abi: routerAbi, functionName: "CENT" }),
  chain.readContract({ address: predicted, abi: routerAbi, functionName: "nextSplitId" }),
]);
if (usdc.toLowerCase() !== USDC.toLowerCase()) throw new Error(`usdc() is ${usdc}, expected ${USDC}`);
if (cent !== 10_000n) throw new Error(`CENT() is ${cent}`);

const record = {
  network: blockchain === "ARC" ? "arc-mainnet" : "arc-testnet",
  chainId,
  router: predicted,
  usdc: USDC,
  create2Factory: FACTORY,
  salt: SALT,
  initCodeHash: keccak256(initCode),
  runtimeCodeHash: keccak256(code),
  deployTx: txHash,
  nextSplitId: nextId.toString(),
  verifiedAt: new Date().toISOString(),
};
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${record.network}.json`);
writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
console.log(`Verified onchain and recorded in ${file}`);
console.log(JSON.stringify(record, null, 2));
