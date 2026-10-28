import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, stringToHex, type Hex, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { transmitterAbi } from "../crosschain/cctp";
import { crossPayAbi } from "../crosschain/crossPayAbi";
import { outcomeAfterMint } from "./viemChain";

const TRANSMITTER = getAddress("0x81d40f21f12a8f0e3252bccb954d722d4c464b64");
const CROSS_PAY = getAddress("0x00000000000000000000000000000000000000c9");
const IMPOSTOR = getAddress("0x00000000000000000000000000000000000000e1");
const PAYER = getAddress("0x00000000000000000000000000000000000000aa");
const TX = keccak256(stringToHex("relay tx"));
const OURS = keccak256(stringToHex("our nonce"));
const THEIRS = keccak256(stringToHex("their nonce"));
const REF = keccak256(stringToHex("ref"));

function log(address: Hex, topics: Hex[], data: Hex): Omit<Log, "logIndex"> {
  return { address, topics: topics as [Hex, ...Hex[]], data, blockHash: TX, blockNumber: 1n, transactionHash: TX, transactionIndex: 0, removed: false };
}

const minted = (nonce: Hex) =>
  log(
    TRANSMITTER,
    encodeEventTopics({ abi: transmitterAbi, eventName: "MessageReceived", args: { caller: CROSS_PAY, nonce, finalityThresholdExecuted: 1000 } }) as Hex[],
    encodeAbiParameters([{ type: "uint32" }, { type: "bytes32" }, { type: "bytes" }], [6, keccak256("0x01"), "0x"]),
  );
const paid = (feeBack: bigint, from: Hex = CROSS_PAY) =>
  log(
    from,
    encodeEventTopics({ abi: crossPayAbi, eventName: "CrossPaid", args: { ref: REF, payer: PAYER } }) as Hex[],
    encodeAbiParameters([{ type: "uint32" }, { type: "uint256" }, { type: "uint256" }], [6, 10_000_000n, feeBack]),
  );
const refunded = (amount: bigint) =>
  log(
    CROSS_PAY,
    encodeEventTopics({ abi: crossPayAbi, eventName: "Refunded", args: { ref: REF, payer: PAYER } }) as Hex[],
    encodeAbiParameters([{ type: "uint256" }, { type: "uint8" }], [amount, 2]),
  );
const owed = () =>
  log(CROSS_PAY, encodeEventTopics({ abi: crossPayAbi, eventName: "Owed", args: { payer: PAYER } }) as Hex[], encodeAbiParameters([{ type: "uint256" }], [5n]));

const inOrder = (...logs: Omit<Log, "logIndex">[]) => logs.map((l, i) => ({ ...l, logIndex: i }) as Log);

describe("reading SplitsCrossPay's outcome for one CCTP message", () => {
  it("is the event after this nonce's mint", () => {
    expect(outcomeAfterMint(TX, inOrder(minted(OURS), paid(499n)), CROSS_PAY, TRANSMITTER, OURS)).toEqual({ kind: "paid", txHash: TX, feeBack: 499n });
  });

  it("ignores events with this payment's ref and payer from someone else's message", () => {
    // A stranger burned with a hook copying the ref and payer: their mint, their refund.
    expect(outcomeAfterMint(TX, inOrder(minted(THEIRS), refunded(0n)), CROSS_PAY, TRANSMITTER, OURS)).toBeNull();
  });

  it("keeps two messages relayed in one transaction apart", () => {
    const logs = inOrder(minted(THEIRS), refunded(0n), minted(OURS), paid(7n), owed());
    expect(outcomeAfterMint(TX, logs, CROSS_PAY, TRANSMITTER, OURS)).toEqual({ kind: "paid", txHash: TX, feeBack: 7n });
    expect(outcomeAfterMint(TX, logs, CROSS_PAY, TRANSMITTER, THEIRS)).toEqual({ kind: "refunded", txHash: TX, amount: 0n, owed: false });
  });

  it("sees a refund held as owed only within its own message", () => {
    expect(outcomeAfterMint(TX, inOrder(minted(OURS), refunded(5n), owed()), CROSS_PAY, TRANSMITTER, OURS)).toMatchObject({ kind: "refunded", owed: true });
  });

  it("ignores look-alike events from another contract and mints from another transmitter", () => {
    expect(outcomeAfterMint(TX, inOrder(minted(OURS), paid(1n, IMPOSTOR)), CROSS_PAY, TRANSMITTER, OURS)).toBeNull();
    expect(outcomeAfterMint(TX, inOrder({ ...minted(OURS), address: IMPOSTOR }, paid(1n)), CROSS_PAY, TRANSMITTER, OURS)).toBeNull();
  });
});
