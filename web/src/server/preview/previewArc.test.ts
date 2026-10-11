import { encodeFunctionData, erc20Abi, getAddress, keccak256, stringToHex } from "viem";
import { describe, expect, it } from "vitest";
import { splitsRouterAbi } from "../chain/abi";
import { purposeToBytes32 } from "../domain/money";
import { PREVIEW_TREASURY_WALLET_ID, PreviewArc } from "./previewArc";

const W1 = getAddress("0x00000000000000000000000000000000000a0001");
const W2 = getAddress("0x00000000000000000000000000000000000a0002");

async function payer(arc: PreviewArc) {
  const { providerWalletId, address } = await arc.walletProvider.createWallet({ refId: "p", name: "main", idempotencyKey: "k-p" });
  arc.mint(address, 10_000_000n);
  await arc.walletProvider.execute({
    walletId: providerWalletId,
    contract: arc.usdc,
    callData: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [arc.router, 10_000_000n] }),
    idempotencyKey: "k-approve",
    refId: "a",
  });
  return { providerWalletId, address };
}

describe("PreviewArc pay", () => {
  it("pays fixed legs once, with split id 0 receipts, and records inbound transfers", async () => {
    const arc = new PreviewArc({ pendingPolls: 0 });
    const p = await payer(arc);
    const ref = keccak256(stringToHex("one-off"));
    const legs = [
      { recipient: W1, fixedAmount: 1_000_000n, shareBps: 0, purpose: purposeToBytes32("prize") },
      { recipient: W2, fixedAmount: 2_000_000n, shareBps: 0, purpose: purposeToBytes32("prize") },
    ];
    const { providerTxId } = await arc.walletProvider.execute({
      walletId: p.providerWalletId,
      contract: arc.router,
      callData: encodeFunctionData({ abi: splitsRouterAbi, functionName: "pay", args: [legs, 3_000_000n, ref] }),
      idempotencyKey: "k-pay",
      refId: "pay",
    });
    const tx = await arc.walletProvider.getTx(providerTxId);
    expect(tx.status).toBe("complete");
    const receipt = await arc.chainReader.receipt(tx.txHash!);
    expect(receipt!.splitSent[0]).toMatchObject({ splitId: 0n, amount: 3_000_000n });
    expect(receipt!.legPaid.map((l) => [l.splitId, l.recipient, l.amount])).toEqual([
      [0n, W1, 1_000_000n],
      [0n, W2, 2_000_000n],
    ]);
    expect(await arc.chainReader.usdcBalance(W2)).toBe(2_000_000n);
    expect(arc.inboundFor(W2)).toEqual([{ txHash: tx.txHash, from: p.address, amount: 2_000_000n, at: expect.any(Date) }]);
    // The payer only sent money: a mint and an approval are not inbound transfers.
    expect(await arc.walletProvider.listInbound(p.providerWalletId, 10)).toEqual([]);
  });

  it("refuses a reused ref for pay, like the router", async () => {
    const arc = new PreviewArc({ pendingPolls: 0 });
    const p = await payer(arc);
    const ref = keccak256(stringToHex("twice"));
    const call = encodeFunctionData({
      abi: splitsRouterAbi,
      functionName: "pay",
      args: [[{ recipient: W1, fixedAmount: 10_000n, shareBps: 0, purpose: purposeToBytes32("x") }], 10_000n, ref],
    });
    await arc.walletProvider.execute({ walletId: p.providerWalletId, contract: arc.router, callData: call, idempotencyKey: "k1", refId: "1" });
    const second = await arc.walletProvider.execute({ walletId: p.providerWalletId, contract: arc.router, callData: call, idempotencyKey: "k2", refId: "2" });
    const tx = await arc.walletProvider.getTx(second.providerTxId);
    expect(tx.status).toBe("failed");
    expect(tx.error).toContain("RefAlreadyUsed");
  });

  it("probes whether an address can receive, without moving money", async () => {
    const arc = new PreviewArc();
    const treasury = arc.walletAddress(PREVIEW_TREASURY_WALLET_ID)!;
    const before = await arc.chainReader.usdcBalance(treasury);
    expect(await arc.chainReader.canReceive(treasury, W1)).toBe(true);
    arc.setBlocked(W1, true);
    expect(await arc.chainReader.canReceive(treasury, W1)).toBe(false);
    expect(await arc.chainReader.usdcBalance(treasury)).toBe(before);
  });

  it("probes even when the probing address holds nothing, like the live balance override", async () => {
    const arc = new PreviewArc();
    const empty = getAddress("0x00000000000000000000000000000000000e1234");
    expect(await arc.chainReader.canReceive(empty, W1)).toBe(true);
  });

  it("knows a wallet's address", async () => {
    const arc = new PreviewArc();
    expect(await arc.walletProvider.walletAddress(PREVIEW_TREASURY_WALLET_ID)).toBe(arc.walletAddress(PREVIEW_TREASURY_WALLET_ID));
  });
});

const outsider = getAddress("0x00000000000000000000000000000000000000d1");
const friend = getAddress("0x00000000000000000000000000000000000000d2");

describe("PreviewArc calls from outside wallets", () => {
  it("lets an outside wallet approve and pay, and finds the payment by payer and ref", async () => {
    const arc = new PreviewArc();
    arc.mint(outsider, 5_000_000n);
    const ref = keccak256(stringToHex("visitor-1"));
    const from = await arc.chainReader.blockNumber();
    arc.callFrom(outsider, arc.usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [arc.router, 2_000_000n] }));
    const hash = arc.callFrom(
      outsider,
      arc.router,
      encodeFunctionData({
        abi: splitsRouterAbi,
        functionName: "pay",
        args: [[{ recipient: friend, fixedAmount: 2_000_000n, shareBps: 0, purpose: purposeToBytes32("gift") }], 2_000_000n, ref],
      }),
    );
    expect((await arc.chainReader.receipt(hash))?.status).toBe("success");
    expect(await arc.chainReader.usdcBalance(friend)).toBe(2_000_000n);
    expect(await arc.chainReader.findSplitSent(outsider, ref, from)).toBe(hash);
    expect(await arc.chainReader.findSplitSent(friend, ref, from)).toBeNull();
    expect(await arc.chainReader.findSplitSent(outsider, ref, (await arc.chainReader.blockNumber()) + 1n)).toBeNull();
  });

  it("records a revert and finds nothing", async () => {
    const arc = new PreviewArc();
    const ref = keccak256(stringToHex("visitor-2"));
    const hash = arc.callFrom(
      outsider,
      arc.router,
      encodeFunctionData({
        abi: splitsRouterAbi,
        functionName: "pay",
        args: [[{ recipient: friend, fixedAmount: 1_000_000n, shareBps: 0, purpose: purposeToBytes32("gift") }], 1_000_000n, ref],
      }),
    );
    expect((await arc.chainReader.receipt(hash))?.status).toBe("reverted");
    expect(await arc.chainReader.findSplitSent(outsider, ref, 0n)).toBeNull();
  });
});
