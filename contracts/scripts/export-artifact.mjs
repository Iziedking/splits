// Writes the trimmed, reviewable deploy artifact from forge's build output.
// Usage (from contracts/, after `forge build`): node scripts/export-artifact.mjs ../deployments/artifacts/SplitsRouter.json
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) throw new Error("Give the output path");
const build = JSON.parse(readFileSync("out/SplitsRouter.sol/SplitsRouter.json", "utf8"));
const source = readFileSync("src/SplitsRouter.sol", "utf8");
const meta = typeof build.rawMetadata === "string" ? JSON.parse(build.rawMetadata) : build.metadata;
const artifact = {
  contract: "SplitsRouter",
  source: "contracts/src/SplitsRouter.sol",
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  compiler: meta.compiler.version,
  evmVersion: meta.settings.evmVersion,
  optimizerRuns: meta.settings.optimizer.runs,
  builtWith: "arc-forge 1.7.1-dev (arc-foundry v0.8.0-2)",
  abi: build.abi,
  bytecode: { object: build.bytecode.object },
};
writeFileSync(out, JSON.stringify(artifact, null, 2) + "\n");
console.log(`wrote ${out} (${artifact.bytecode.object.length / 2 - 1} bytes of init code)`);
