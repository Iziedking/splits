import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { toFunctionSelector, toEventSelector, type AbiEvent, type AbiFunction } from "viem";
import { describe, expect, it } from "vitest";
import { splitsRouterAbi } from "./abi";

/**
 * The app's hand-written ABI must match the compiled contract exactly, or calls would revert or
 * events would be missed. Needs `forge build` in ../contracts first.
 */
const ARTIFACT = path.resolve(process.cwd(), "../contracts/out/SplitsRouter.sol/SplitsRouter.json");

describe("SplitsRouter ABI", () => {
  it("matches the compiled contract", () => {
    expect(existsSync(ARTIFACT), `missing ${ARTIFACT}; run forge build in contracts/`).toBe(true);
    const compiled = JSON.parse(readFileSync(ARTIFACT, "utf8")).abi as (AbiFunction | AbiEvent)[];
    const selectors = (abi: readonly unknown[]) =>
      (abi as (AbiFunction | AbiEvent | { type: string })[])
        .filter((x): x is AbiFunction | AbiEvent => x.type === "function" || x.type === "event")
        .map((x) => (x.type === "function" ? toFunctionSelector(x) : toEventSelector(x)))
        .sort();

    const ours = selectors(splitsRouterAbi);
    const theirs = new Set(selectors(compiled));
    for (const s of ours) expect(theirs.has(s), `selector ${s} not in compiled ABI`).toBe(true);

    const events = compiled.filter((x) => x.type === "event").map((x) => toEventSelector(x as AbiEvent));
    for (const e of events) expect(ours).toContain(e);
  });
});
