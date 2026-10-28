import { deterministicUuid } from "../domain/ids";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, pad, stringToHex, toHex, type Address, type Hex, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { depositWallets } from "../db/schema";
import { AppError } from "../errors";
import { ensureMainWallet, ensureUser } from "../services/users";
import { ensureDepositWallet } from "../services/depositWallets";
import { testCtx } from "../testing";
import { depositForBurnEvent, encodeApprove, encodeDepositForBurn, encodeReceiveMessage, maxFeeFor, parseBurnMessage } from "./cctp";
import { CCTP, SOURCE_CHAINS } from "./chains";
import { burnsInReceipt, createSourceReader, isRangeRefusal, sumUsdcTransfers } from "./reader";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function setup(env: Record<string, string> = {}) {
  const t = await testCtx(env);
  const user = await ensureUser(t.ctx, "ada@example.com", "active");
  const main = await ensureMainWallet(t.ctx, user);
  return { ...t, user, main };
}

const until = async <T>(fn: () => Promise<T>, done: (v: T) => boolean) => {
  for (let i = 0; i < 10; i++) {
    const v = await fn();
    if (done(v)) return v;
  }
  throw new Error("never finished");
};

describe("deposit wallets", () => {
  it("puts the person's own Splits address on each enabled chain, once", async () => {
    const { ctx, user, main } = await setup();
    const a = await ensureDepositWallet(ctx, user, SOURCE_CHAINS.base);
    const b = await ensureDepositWallet(ctx, user, SOURCE_CHAINS.base);
    expect(a.id).toBe(b.id);
    expect(a.address.toLowerCase()).toBe(main.address.toLowerCase());
    expect((await ensureDepositWallet(ctx, user, SOURCE_CHAINS.arb)).address).toBe(a.address);
  });

  it("refuses to open a deposit address that isn't the person's Splits address (final review I9)", async () => {
    const { ctx, user } = await setup();
    const wallets = { ...ctx.wallets, deriveOn: async () => ({ providerWalletId: "elsewhere", address: "0x00000000000000000000000000000000000000f1" as const }) };
    await expect(ensureDepositWallet({ ...ctx, wallets }, user, SOURCE_CHAINS.base)).rejects.toThrow(/not the same address/);
    expect(await ctx.db.select().from(depositWallets)).toHaveLength(0);
  });

  it("refuses a chain that isn't switched on", async () => {
    const { ctx, user } = await setup({ DEPOSIT_CHAINS: "base" });
    const err = await ensureDepositWallet(ctx, user, SOURCE_CHAINS.eth).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("CHAIN_OFF");
  });
});

describe("the simulated route from another chain to Arc", () => {
  it("deposits on Base, burns, attests and mints on Arc exactly once", async () => {
    const { ctx, arc, user, main } = await setup();
    const cross = ctx.crossChain;
    const base = SOURCE_CHAINS.base;
    const usdc = base.usdc[cross.network];
    const wallet = await ensureDepositWallet(ctx, user, base);
    const deposit = wallet.address as Address;

    const depositTx = arc.simulateDeposit("base", deposit, 5_000_000n);
    expect(await cross.reader.verifyInbound(base, depositTx, deposit)).toEqual({ ok: true, amount: 5_000_000n });
    expect(await cross.reader.verifyInbound(base, depositTx, getAddress("0x00000000000000000000000000000000000000f1"))).toEqual({ ok: false });
    expect(await cross.reader.usdcBalance(base, deposit)).toBe(5_000_000n);

    const { fastBps } = await cross.iris.fees(base.domain);
    const maxFee = maxFeeFor(5_000_000n, fastBps);
    await ctx.wallets.execute({ walletId: wallet.providerWalletId, contract: usdc, callData: encodeApprove(cross.cctp.tokenMessenger, 5_000_000n), idempotencyKey: deterministicUuid("k1"), refId: "r" });
    const { providerTxId } = await ctx.wallets.execute({
      walletId: wallet.providerWalletId,
      contract: cross.cctp.tokenMessenger,
      callData: encodeDepositForBurn({ amount: 5_000_000n, mintRecipient: deposit, burnToken: usdc, maxFee, fast: true }),
      idempotencyKey: deterministicUuid("k2"),
      refId: "r",
    });
    const burn = await until(() => ctx.wallets.getTx(providerTxId), (t) => t.status !== "pending");
    expect(burn.status).toBe("complete");
    expect(await cross.reader.usdcBalance(base, deposit)).toBe(0n);

    const msg = await cross.iris.message(base.domain, burn.txHash!);
    if (msg.status !== "complete") throw new Error("not attested");
    const parsed = parseBurnMessage(msg.message);
    expect(parsed).toMatchObject({ sourceDomain: 6, destinationDomain: 26, mintRecipient: main.address as Address, amount: 5_000_000n });

    const before = await ctx.chain.usdcBalance(main.address as Address);
    const mint = await ctx.wallets.execute({ walletId: ctx.treasuryWalletId, contract: cross.cctp.messageTransmitter, callData: encodeReceiveMessage(msg.message, msg.attestation), idempotencyKey: deterministicUuid("k3"), refId: "r" });
    expect((await until(() => ctx.wallets.getTx(mint.providerTxId), (t) => t.status !== "pending")).status).toBe("complete");
    expect((await ctx.chain.usdcBalance(main.address as Address)) - before).toBe(5_000_000n - parsed.feeExecuted);
    expect(await ctx.chain.cctpNonceUsed(cross.cctp.messageTransmitter, parsed.nonce)).toBe(true);

    const again = await ctx.wallets.execute({ walletId: ctx.treasuryWalletId, contract: cross.cctp.messageTransmitter, callData: encodeReceiveMessage(msg.message, msg.attestation), idempotencyKey: deterministicUuid("k4"), refId: "r" });
    expect((await until(() => ctx.wallets.getTx(again.providerTxId), (t) => t.status !== "pending")).status).toBe("failed");
    expect(CCTP.testnet.messageTransmitter).toBe(cross.cctp.messageTransmitter);
  });
});

describe("reading an inbound USDC transfer from a receipt", () => {
  const usdc = SOURCE_CHAINS.base.usdc.mainnet;
  const to = getAddress("0xaa904b4ac117838ce68f5263cfe3e0a7ee4a267c");
  const log = (address: string, recipient: string, value: bigint) => ({
    address,
    topics: [TRANSFER, pad("0x01"), pad(recipient as Hex)] as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  });

  it("adds up USDC transfers to the address and ignores everything else", () => {
    const fakeToken = getAddress(`0x${keccak256(stringToHex("x")).slice(-40)}`);
    expect(
      sumUsdcTransfers([log(usdc, to, 3_000_000n), log(usdc, to, 2_000_000n), log(fakeToken, to, 9n), log(usdc, "0x00000000000000000000000000000000000000f1", 7n)], usdc, to),
    ).toBe(5_000_000n);
  });
});

describe("reading a burn on its source chain", () => {
  it("reads only TokenMessenger burns from a source receipt", () => {
    const receipt = { status: "success" as const, from: "0x00000000000000000000000000000000000000aa" as Address, logs: [] };
    expect(burnsInReceipt(receipt, CCTP.testnet.tokenMessenger, 7)).toEqual({ status: "success", from: getAddress(receipt.from), nonce: 7, burns: [] });
    expect(burnsInReceipt({ ...receipt, status: "reverted" }, CCTP.testnet.tokenMessenger, 7).burns).toEqual([]);
  });
});

describe("searching a payer's burns on a source chain", () => {
  const PAYER = getAddress("0xa045e8104bc066fff5bfc673abf354871edc03c5");
  const OTHER = getAddress("0x00000000000000000000000000000000000000f1");
  const base = SOURCE_CHAINS.base;

  const burnLog = (block: bigint, depositor: Address) => ({
    address: CCTP.testnet.tokenMessenger,
    topics: encodeEventTopics({ abi: [depositForBurnEvent], eventName: "DepositForBurn", args: { burnToken: base.usdc.testnet, depositor, minFinalityThreshold: 1000 } }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "uint32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes" }],
      [1_000_000n, pad(OTHER), 26, pad(CCTP.testnet.tokenMessenger), pad(OTHER), 0n, "0x"],
    ),
    blockNumber: block,
    transactionHash: keccak256(toHex(block)),
  });

  /** An RPC like sepolia.base.org: getLogs refuses more than `max` blocks a call. */
  function rpc(max: number, burns: { block: bigint; depositor: Address }[]) {
    const state = { head: 10_000n, calls: [] as [bigint, bigint][], tried: 0, refused: 0, fail: null as Error | null };
    const client = {
      getBlockNumber: async () => state.head,
      getLogs: async ({ fromBlock, toBlock, args }: { fromBlock: bigint; toBlock: bigint; args: { depositor: Address } }) => {
        state.tried++;
        if (state.fail) throw state.fail;
        if (toBlock - fromBlock + 1n > BigInt(max)) {
          state.refused++;
          throw new Error(`RPC Request failed.\n\nDetails: eth_getLogs is limited to a ${max} range`);
        }
        state.calls.push([fromBlock, toBlock]);
        return burns.filter((b) => b.block >= fromBlock && b.block <= toBlock && b.depositor === args.depositor).map((b) => burnLog(b.block, b.depositor));
      },
    };
    const reader = createSourceReader("testnet", {}, () => client as unknown as PublicClient);
    return { reader, state };
  }
  const blocksOf = (r: { burn: unknown; txHash: Hex }[]) => r.map((b) => b.txHash);
  const searched = (calls: [bigint, bigint][]) => calls.reduce((n, [a, b]) => n + (b - a + 1n), 0n);

  it("finds every burn when the RPC serves fewer blocks a call than the chain table says", async () => {
    const { reader, state } = rpc(200, [{ block: 1_234n, depositor: PAYER }, { block: 5_000n, depositor: OTHER }, { block: 9_990n, depositor: PAYER }]);
    const found = await reader.burnsFrom(base, PAYER, 1_000n);
    expect(blocksOf(found)).toEqual([keccak256(toHex(1_234n)), keccak256(toHex(9_990n))]);
    expect(found[0]?.burn).toMatchObject({ depositor: PAYER, amount: 1_000_000n });
    expect(state.calls.every(([a, b]) => b - a + 1n <= 200n)).toBe(true);
    // It keeps the width that worked instead of being refused again.
    const refused = state.refused;
    state.head += 1_000n;
    await reader.burnsFrom(base, PAYER, 1_000n);
    expect(state.refused).toBe(refused);
  });

  it("searches only the blocks since the last search, plus the ones a reorg could still change", async () => {
    const burns = [{ block: 1_234n, depositor: PAYER }];
    const { reader, state } = rpc(10_000, burns);
    await reader.burnsFrom(base, PAYER, 1_000n);
    expect(searched(state.calls)).toBe(9_001n);
    state.calls = [];
    state.head += 100n;
    burns.push({ block: 10_050n, depositor: PAYER });
    const found = await reader.burnsFrom(base, PAYER, 1_000n);
    expect(searched(state.calls)).toBe(164n);
    expect(blocksOf(found)).toEqual([keccak256(toHex(1_234n)), keccak256(toHex(10_050n))]);
  });

  it("starts over for an earlier block, and leaves out burns before the block asked from", async () => {
    const { reader } = rpc(10_000, [{ block: 700n, depositor: PAYER }, { block: 1_234n, depositor: PAYER }]);
    await reader.burnsFrom(base, PAYER, 1_000n);
    expect(blocksOf(await reader.burnsFrom(base, PAYER, 500n))).toEqual([keccak256(toHex(700n)), keccak256(toHex(1_234n))]);
    expect(blocksOf(await reader.burnsFrom(base, PAYER, 1_000n))).toEqual([keccak256(toHex(1_234n))]);
  });

  it("tells a range refusal from a rate limit, as the public RPCs word them", () => {
    for (const m of ["eth_getLogs is limited to a 200 range", "block range too large: total block range in this request exceeds the maximum of 100 blocks", "block range greater than 1000 max", "query returned more than 10000 results"]) {
      expect(isRangeRefusal(new Error(m))).toBe(true);
    }
    expect(isRangeRefusal(new Error("request limit reached"))).toBe(false);
    expect(isRangeRefusal(new Error("HTTP request failed."))).toBe(false);
  });

  it("fails on an RPC that's down instead of narrowing the search forever", async () => {
    const { reader, state } = rpc(10_000, []);
    state.fail = new Error("HTTP request failed.");
    await expect(reader.burnsFrom(base, PAYER, 1_000n)).rejects.toThrow(/HTTP request failed/);
    expect(state.tried).toBe(1);
  });
});
