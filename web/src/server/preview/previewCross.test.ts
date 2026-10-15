import { encodeFunctionData, erc20Abi, getAddress, keccak256, stringToHex, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { encodeDepositForBurnWithHook, encodeHook, transmitterAbi } from "../crosschain/cctp";
import { CCTP, SOURCE_CHAINS } from "../crosschain/chains";
import { crossPayAbi } from "../crosschain/crossPayAbi";
import { PREVIEW_TREASURY_WALLET_ID, PreviewArc } from "./previewArc";

const PAYER = getAddress("0x00000000000000000000000000000000000000aa");
const A = getAddress("0x00000000000000000000000000000000000000f1");
const REF = keccak256(stringToHex("r"));
const legs = [{ recipient: A, fixedAmount: 5_000_000n, shareBps: 0, purpose: keccak256(stringToHex("p")) }];

/** The visitor's wallet on Base Sepolia: approve, then burn to SplitsCrossPay with the split in the hook. */
function burn(arc: PreviewArc, amount: bigint, payAmount: bigint) {
  const base = SOURCE_CHAINS.base;
  arc.fundSource("base", PAYER, amount);
  arc.sourceCall("base", PAYER, base.usdc.testnet, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CCTP.testnet.tokenMessenger, amount] }));
  return arc.sourceCall(
    "base",
    PAYER,
    CCTP.testnet.tokenMessenger,
    encodeDepositForBurnWithHook({ amount, burnToken: base.usdc.testnet, maxFee: 1_000n, fast: true, hookData: encodeHook(legs, payAmount, REF, PAYER), crossPay: arc.crossPay }),
  );
}

async function attested(arc: PreviewArc, tx: Hex) {
  const msg = await arc.iris.message(6, tx);
  if (msg.status !== "complete") throw new Error("expected an attestation");
  return msg;
}

async function relayFromTreasury(arc: PreviewArc, message: Hex, attestation: Hex) {
  const { providerTxId } = await arc.walletProvider.execute({
    walletId: PREVIEW_TREASURY_WALLET_ID,
    contract: arc.crossPay,
    callData: encodeFunctionData({ abi: crossPayAbi, functionName: "relay", args: [message, attestation] }),
    idempotencyKey: crypto.randomUUID(),
    refId: "t",
  });
  return arc.walletProvider.getTx(providerTxId);
}

describe("preview cross-chain pay", () => {
  it("burns on a source chain and lets only SplitsCrossPay mint, paying the split", async () => {
    const arc = new PreviewArc({ pendingPolls: 0 });
    const tx = burn(arc, 5_001_000n, 5_000_000n);
    const receipt = await arc.sourceReader.burnReceipt(SOURCE_CHAINS.base, tx);
    expect(receipt?.burns[0]?.destinationCaller).toBe(arc.crossPay);
    expect(receipt?.from).toBe(PAYER);
    const msg = await attested(arc, tx);
    expect((await relayFromTreasury(arc, msg.message, msg.attestation)).status).not.toBe("failed");
    expect(await arc.chainReader.usdcBalance(A)).toBe(5_000_000n);
    expect(await arc.chainReader.usdcBalance(PAYER)).toBe(499n); // 1 bps of 5_001_000, rounded up (501), taken from the 1_000 maxFee
    expect(await arc.chainReader.crossPayOutcome(arc.crossPay, REF, PAYER, 0n)).toMatchObject({ kind: "paid", feeBack: 499n });
  });

  it("refunds the burner when a recipient can't receive", async () => {
    const arc = new PreviewArc({ pendingPolls: 0 });
    arc.setBlocked(A, true);
    const msg = await attested(arc, burn(arc, 5_001_000n, 5_000_000n));
    await relayFromTreasury(arc, msg.message, msg.attestation);
    expect(await arc.chainReader.usdcBalance(PAYER)).toBe(5_000_499n);
    expect(await arc.chainReader.crossPayOutcome(arc.crossPay, REF, PAYER, 0n)).toMatchObject({ kind: "refunded", owed: false });
  });

  it("holds the refund as owed when the payer can't receive either", async () => {
    const arc = new PreviewArc({ pendingPolls: 0 });
    arc.setBlocked(A, true);
    arc.setBlocked(PAYER, true);
    const msg = await attested(arc, burn(arc, 5_001_000n, 5_000_000n));
    await relayFromTreasury(arc, msg.message, msg.attestation);
    expect(await arc.chainReader.crossPayOutcome(arc.crossPay, REF, PAYER, 0n)).toMatchObject({ kind: "refunded", owed: true });
  });

  it("refuses a mint by anyone but the destination caller", async () => {
    const arc = new PreviewArc({ pendingPolls: 0 });
    const msg = await attested(arc, burn(arc, 5_001_000n, 5_000_000n));
    const hash = arc.callFrom(PAYER, CCTP.testnet.messageTransmitter, encodeFunctionData({ abi: transmitterAbi, functionName: "receiveMessage", args: [msg.message, msg.attestation] }));
    expect((await arc.chainReader.receipt(hash))?.status).toBe("reverted");
  });

  it("counts a burn replaced at the same nonce as gone", async () => {
    const arc = new PreviewArc({ pendingPolls: 0 });
    const dropped = arc.dropSourceTx("base", PAYER, 0);
    expect(await arc.sourceReader.burnReceipt(SOURCE_CHAINS.base, dropped)).toBeNull();
    expect(await arc.sourceReader.transactionNonce(SOURCE_CHAINS.base, dropped)).toBe(0);
    expect(await arc.sourceReader.pendingNonce(SOURCE_CHAINS.base, PAYER)).toBe(1);
  });
});
