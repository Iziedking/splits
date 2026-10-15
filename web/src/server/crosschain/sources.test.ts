import { deterministicUuid } from "../domain/ids";
import { encodeAbiParameters, getAddress, keccak256, pad, stringToHex, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { depositWallets } from "../db/schema";
import { AppError } from "../errors";
import { ensureMainWallet, ensureUser } from "../services/users";
import { ensureDepositWallet } from "../services/depositWallets";
import { testCtx } from "../testing";
import { encodeApprove, encodeDepositForBurn, encodeReceiveMessage, maxFeeFor, parseBurnMessage } from "./cctp";
import { CCTP, SOURCE_CHAINS } from "./chains";
import { burnsInReceipt, sumUsdcTransfers } from "./reader";

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
