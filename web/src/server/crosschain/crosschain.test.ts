import { decodeFunctionData, encodePacked, getAddress, pad, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { burnAbi, encodeApprove, encodeDepositForBurn, encodeReceiveMessage, maxFeeFor, nonceOf, parseBurnMessage, toBytes32 } from "./cctp";
import { ARC_DOMAIN, CCTP, chainByCircleCode, enabledChains, SOURCE_CHAINS } from "./chains";
import { httpIris } from "./iris";

const RECIPIENT = getAddress("0xaa904b4ac117838ce68f5263cfe3e0a7ee4a267c");
const BASE_USDC = SOURCE_CHAINS.base.usdc.mainnet;

/** A CCTP V2 message laid out as the MessageTransmitterV2 emits it. */
function v2Message(o: { nonce: Hex; amount: bigint; feeExecuted: bigint; recipient: Hex; sourceDomain?: number }): Hex {
  const body = encodePacked(
    ["uint32", "bytes32", "bytes32", "uint256", "bytes32", "uint256", "uint256", "uint256"],
    [1, toBytes32(BASE_USDC), toBytes32(o.recipient), o.amount, toBytes32(RECIPIENT), 999n, o.feeExecuted, 0n],
  );
  return encodePacked(
    ["uint32", "uint32", "uint32", "bytes32", "bytes32", "bytes32", "bytes32", "uint32", "uint32", "bytes"],
    [1, o.sourceDomain ?? 6, ARC_DOMAIN, o.nonce, pad("0x01"), pad("0x02"), pad("0x00"), 1000, 1000, body],
  );
}

describe("chain table", () => {
  it("knows every source chain on both networks, each with its own domain", () => {
    const chains = Object.values(SOURCE_CHAINS);
    expect(chains.map((c) => c.key).sort()).toEqual(["arb", "avax", "base", "eth", "matic", "monad", "op", "uni"]);
    expect(new Set(chains.map((c) => c.domain)).size).toBe(chains.length);
    for (const c of chains) {
      expect(c.circle.mainnet && c.circle.testnet && c.usdc.mainnet && c.usdc.testnet && c.rpc.mainnet && c.rpc.testnet).toBeTruthy();
    }
    expect(ARC_DOMAIN).toBe(26);
    expect(SOURCE_CHAINS.base.domain).toBe(6);
    expect(SOURCE_CHAINS.eth.minUnits).toBe(20_000_000n);
    expect(SOURCE_CHAINS.base.minUnits).toBe(1_000_000n);
  });

  it("enables only known chains and refuses a typo at startup", () => {
    expect(enabledChains(["base", "arb"]).map((c) => c.key)).toEqual(["base", "arb"]);
    expect(enabledChains([])).toEqual([]);
    expect(() => enabledChains(["base", "nope"])).toThrow(/nope/);
  });

  it("maps a Circle blockchain code back to its chain and network", () => {
    expect(chainByCircleCode("BASE")).toEqual({ chain: SOURCE_CHAINS.base, network: "mainnet" });
    expect(chainByCircleCode("ARB-SEPOLIA")).toEqual({ chain: SOURCE_CHAINS.arb, network: "testnet" });
    expect(chainByCircleCode("ARC")).toBeNull();
  });

  it("uses one CCTP V2 address pair per network", () => {
    expect(CCTP.mainnet.tokenMessenger).toBe("0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d");
    expect(CCTP.testnet.messageTransmitter).toBe("0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275");
  });
});

describe("CCTP codec", () => {
  it("burns to Arc for the recipient, fast or standard, with no destination caller", () => {
    for (const [fast, threshold] of [
      [true, 1000],
      [false, 2000],
    ] as const) {
      const data = encodeDepositForBurn({ amount: 5_000_000n, mintRecipient: RECIPIENT, burnToken: BASE_USDC, maxFee: 780n, fast });
      const { functionName, args } = decodeFunctionData({ abi: burnAbi, data });
      expect(functionName).toBe("depositForBurn");
      expect(args).toEqual([5_000_000n, 26, toBytes32(RECIPIENT), BASE_USDC, pad("0x00"), 780n, threshold]);
    }
  });

  it("encodes the approve and the mint", () => {
    expect(encodeApprove(CCTP.mainnet.tokenMessenger, 5n).slice(0, 10)).toBe("0x095ea7b3");
    expect(encodeReceiveMessage("0x1234", "0xabcd").slice(0, 10)).toBe("0x57ecfd28");
  });

  it("reads the nonce, recipient, amount and fee from a V2 message", () => {
    const nonce = pad("0xbeef", { size: 32 });
    const message = v2Message({ nonce, amount: 5_000_000n, feeExecuted: 650n, recipient: RECIPIENT });
    expect(nonceOf(message)).toBe(nonce);
    expect(parseBurnMessage(message)).toEqual({
      sourceDomain: 6,
      destinationDomain: 26,
      nonce,
      destinationCaller: "0x0000000000000000000000000000000000000000",
      mintRecipient: RECIPIENT,
      amount: 5_000_000n,
      messageSender: RECIPIENT,
      feeExecuted: 650n,
      hookData: "0x",
    });
  });

  it("prices maxFee from fractional basis points, rounded up, with a 20% buffer", () => {
    expect(maxFeeFor(1_000_000n, 1)).toBe(120n);
    expect(maxFeeFor(1_000_000n, 1.3)).toBe(156n);
    expect(maxFeeFor(1n, 1)).toBe(2n);
    expect(maxFeeFor(50_000_000n, 0)).toBe(0n);
  });
});

describe("Iris client", () => {
  const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it("picks fees by finality threshold, not by position", async () => {
    const iris = httpIris("https://iris.test", reply(200, [{ finalityThreshold: 2000, minimumFee: 0 }, { finalityThreshold: 1000, minimumFee: 1.3 }]));
    expect(await iris.fees(6)).toEqual({ fastBps: 1.3, standardBps: 0 });
  });

  it("reads a message: unseen, pending, then complete", async () => {
    expect(await httpIris("https://iris.test", reply(404, { error: "not found" })).message(6, "0x01")).toEqual({ status: "missing" });
    expect(await httpIris("https://iris.test", reply(200, { messages: [] })).message(6, "0x01")).toEqual({ status: "missing" });
    expect(
      await httpIris("https://iris.test", reply(200, { messages: [{ message: "0x", attestation: "PENDING", status: "pending_confirmations", delayReason: null }] })).message(6, "0x01"),
    ).toEqual({ status: "pending", delayReason: null });
    expect(
      await httpIris("https://iris.test", reply(200, { messages: [{ message: "0xaa", attestation: "0xbb", status: "complete", delayReason: null }] })).message(6, "0x01"),
    ).toEqual({ status: "complete", message: "0xaa", attestation: "0xbb" });
  });

  it("picks this payment's burn from a transaction that holds several", async () => {
    const two = reply(200, {
      messages: [
        { message: "0xaa", attestation: "0x01", status: "complete", delayReason: null },
        { message: "0xbb", attestation: "0x02", status: "complete", delayReason: null },
      ],
    });
    expect(await httpIris("https://iris.test", two).message(6, "0x01", (m) => m === "0xbb")).toEqual({ status: "complete", message: "0xbb", attestation: "0x02" });
    expect(await httpIris("https://iris.test", two).message(6, "0x01", () => false)).toEqual({ status: "missing" });
    expect(await httpIris("https://iris.test", two).message(6, "0x01")).toMatchObject({ message: "0xaa" });
  });

  it("treats a rate limit as retryable", async () => {
    await expect(httpIris("https://iris.test", reply(429, {})).message(6, "0x01")).rejects.toThrow(/rate/i);
  });
});
