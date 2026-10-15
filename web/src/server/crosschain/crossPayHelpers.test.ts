import { describe, expect, it } from "vitest";
import { encodeAbiParameters, zeroAddress, encodeEventTopics, encodePacked, getAddress, keccak256, pad, stringToHex, type Hex } from "viem";
import {
  decodeHook,
  depositForBurnEvent,
  encodeDepositForBurnWithHook,
  encodeHook,
  routerRefFor,
  parseBurnMessage,
  parseDepositForBurnLogs,
  toBytes32,
} from "./cctp";
import { crossPayChains, SOURCE_CHAINS } from "./chains";

const CROSS = getAddress("0x5911750000000000000000000000000000000c05");
const PAYER = getAddress("0x00000000000000000000000000000000000000aa");
const LEGS = [
  { recipient: getAddress("0x00000000000000000000000000000000000000f1"), fixedAmount: 6_000_000n, shareBps: 0, purpose: pad(stringToHex("rent"), { dir: "right" }) },
  { recipient: getAddress("0x00000000000000000000000000000000000000f2"), fixedAmount: 150_000n, shareBps: 0, purpose: pad(stringToHex("splits fee"), { dir: "right" }) },
];
const REF = keccak256(stringToHex("ref"));

function v2Message(o: { sender: Hex; caller: Hex; recipient: Hex; amount: bigint; fee: bigint; hook: Hex }): Hex {
  const body = encodePacked(
    ["uint32", "bytes32", "bytes32", "uint256", "bytes32", "uint256", "uint256", "uint256", "bytes"],
    [1, pad("0x0b"), toBytes32(o.recipient), o.amount, toBytes32(o.sender), o.fee * 2n, o.fee, 0n, o.hook],
  );
  return encodePacked(
    ["uint32", "uint32", "uint32", "bytes32", "bytes32", "bytes32", "bytes32", "uint32", "uint32", "bytes"],
    [1, 6, 26, keccak256(stringToHex("n")), pad("0x01"), pad("0x02"), toBytes32(o.caller), 1000, 1000, body],
  );
}

describe("cross-chain pay helpers", () => {
  it("encodes the hook the contract decodes, and refuses anything else", () => {
    const hook = encodeHook(LEGS, 6_150_000n, REF, PAYER);
    expect(decodeHook(hook)).toEqual({ refundTo: PAYER, legs: LEGS, payAmount: 6_150_000n, ref: REF });
    expect(decodeHook("0xdeadbeef")).toBeNull();
    const v2 = encodeAbiParameters(
      [{ type: "uint8" }, { type: "address" }, { type: "tuple[]", components: [{ name: "recipient", type: "address" }, { name: "fixedAmount", type: "uint96" }, { name: "shareBps", type: "uint16" }, { name: "purpose", type: "bytes32" }] }, { type: "uint256" }, { type: "bytes32" }],
      [2, zeroAddress, LEGS, 6_150_000n, REF],
    );
    expect(decodeHook(v2)).toBeNull();
  });

  it("reads the burner, the caller and the hook from a V2 message", () => {
    const hook = encodeHook(LEGS, 6_150_000n, REF, PAYER);
    const m = parseBurnMessage(v2Message({ sender: PAYER, caller: CROSS, recipient: CROSS, amount: 6_160_000n, fee: 600n, hook }));
    expect(m.messageSender).toBe(PAYER);
    expect(m.destinationCaller).toBe(CROSS);
    expect(m.mintRecipient).toBe(CROSS);
    expect(m.amount).toBe(6_160_000n);
    expect(m.feeExecuted).toBe(600n);
    expect(m.hookData).toBe(hook);
  });

  it("burns with the contract as both recipient and caller", () => {
    const data = encodeDepositForBurnWithHook({ amount: 7n, burnToken: SOURCE_CHAINS.base.usdc.testnet, maxFee: 1n, fast: true, hookData: "0x1234", crossPay: CROSS });
    expect(data.slice(0, 10)).toBe("0x779b432d");
    expect(data.toLowerCase()).toContain(CROSS.slice(2).toLowerCase());
  });

  it("parses DepositForBurn logs only from the real TokenMessenger", () => {
    const messenger = getAddress("0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA");
    const hook = encodeHook(LEGS, 6_150_000n, REF, PAYER);
    const topics = encodeEventTopics({ abi: [depositForBurnEvent], eventName: "DepositForBurn", args: { burnToken: SOURCE_CHAINS.base.usdc.testnet, depositor: PAYER, minFinalityThreshold: 1000 } }) as Hex[];
    const data = encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "uint32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes" }],
      [6_160_000n, toBytes32(CROSS), 26, pad("0x02"), toBytes32(CROSS), 1200n, hook],
    );
    const real = { address: messenger, topics, data };
    const fake = { address: PAYER, topics, data };
    expect(parseDepositForBurnLogs([fake, real], messenger)).toEqual([
      { burnToken: SOURCE_CHAINS.base.usdc.testnet, amount: 6_160_000n, depositor: PAYER, mintRecipient: CROSS, destinationDomain: 26, destinationCaller: CROSS, maxFee: 1200n, minFinalityThreshold: 1000, hookData: hook },
    ]);
  });

  it("knows each chain's EVM id and gas token, and refuses unknown cross-pay chains", () => {
    expect(SOURCE_CHAINS.base.chainId).toEqual({ mainnet: 8453, testnet: 84532 });
    expect(SOURCE_CHAINS.matic.gas).toBe("POL");
    expect(crossPayChains(["base", "eth"]).map((c) => c.key)).toEqual(["base", "eth"]);
    expect(() => crossPayChains(["sol"])).toThrow(/CROSS_PAY_CHAINS/);
  });

  it("pays the router with a ref of the payer's own, as SplitsCrossPay.routerRef does", () => {
    const other = getAddress("0x00000000000000000000000000000000000000bb");
    expect(routerRefFor(6, PAYER, REF)).toBe(keccak256(encodeAbiParameters([{ type: "uint32" }, { type: "address" }, { type: "bytes32" }], [6, PAYER, REF])));
    expect(routerRefFor(6, PAYER, REF)).not.toBe(routerRefFor(6, other, REF));
    expect(routerRefFor(6, PAYER, REF)).not.toBe(routerRefFor(3, PAYER, REF));
  });
});
