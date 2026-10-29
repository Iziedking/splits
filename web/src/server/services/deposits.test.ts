import { deterministicUuid } from "../domain/ids";
import { eq } from "drizzle-orm";
import { getAddress, pad, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { encodeReceiveMessage } from "../crosschain/cctp";
import { SOURCE_CHAINS } from "../crosschain/chains";
import type { Iris } from "../crosschain/iris";
import type { Ctx } from "../context";
import { depositMoves, deposits, notifications } from "../db/schema";
import { runTool } from "../support/tools";
import { testCtx } from "../testing";
import { ensureDepositWallet } from "./depositWallets";
import { activityFor } from "./activity";
import { sweep } from "./sweeper";
import { advanceDeposits, latestDepositFor, pollDepositWallets, recordInbound } from "./deposits";
import { ensureMainWallet, ensureUser } from "./users";

async function setup() {
  const t = await testCtx();
  const user = await ensureUser(t.ctx, "ada@example.com", "active");
  const main = await ensureMainWallet(t.ctx, user);
  const wallet = await ensureDepositWallet(t.ctx, user, SOURCE_CHAINS.base);
  return { ...t, user, main, mainAddress: main.address as Address, wallet, address: wallet.address as Address };
}

/** The sweeper, a few times over: discover deposits, then move them, with time passing. */
async function drive(ctx: Ctx, clock: { advance(ms: number): void }, rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await pollDepositWallets(ctx);
    await advanceDeposits(ctx);
    clock.advance(6_000);
  }
}

const notes = async (ctx: Ctx) =>
  (await ctx.db.select().from(notifications).orderBy(notifications.createdAt)).map((n) => ({ key: n.sourceKey.replace(/:[0-9a-f-]{36}:/, ":<id>:").replace(/:\d{4}-\d{2}-\d{2}$/, ":<day>"), title: n.title, email: n.email }));

describe("moving a deposit from another chain to Arc", () => {
  it("finds a deposit on Base, moves it, and tells the person twice", async () => {
    const { ctx, arc, clock, user, mainAddress, address } = await setup();
    const before = await ctx.chain.usdcBalance(mainAddress);
    arc.simulateDeposit("base", address, 5_000_000n);
    await drive(ctx, clock);

    // 1 bps Fast fee in preview: 500 units.
    expect((await ctx.chain.usdcBalance(mainAddress)) - before).toBe(4_999_500n);
    expect(await ctx.crossChain.reader.usdcBalance(SOURCE_CHAINS.base, address)).toBe(0n);
    const [d] = await ctx.db.select().from(deposits);
    expect(d!.status).toBe("ready");
    expect(await notes(ctx)).toEqual([
      { key: "deposit:<id>:arrived", title: "$5.00 arrived", email: "none" },
      { key: "move:<id>:ready", title: "$4.99 is in your balance", email: "pending" },
    ]);
    expect(await latestDepositFor(ctx, user.id)).toMatchObject({ chain: "base", chainName: "Base", amount: "5.00", status: "ready", minted: "4.99" });
  });

  it("moves a deposit sent to someone who never opened Receive, on every chain that is on", async () => {
    const { ctx, clock, arc } = await testCtx();
    const user = await ensureUser(ctx, "bola@example.com", "active");
    const main = await ensureMainWallet(ctx, user);
    // Bola copied the address from Home and sent from Arbitrum: no deposit wallet was ever opened,
    // so Circle never lists this transfer. The chain's balance is what finds it.
    arc.simulateDeposit("arb", main.address as Address, 5_000_000n);
    for (let i = 0; i < 40; i++) {
      await sweep(ctx);
      clock.advance(6_000);
    }
    expect(await ctx.chain.usdcBalance(main.address as Address)).toBe(4_999_500n);
  });

  it("counts a deposit once when Circle reports it after its balance was already moved", async () => {
    const { ctx, clock, arc } = await testCtx();
    const user = await ensureUser(ctx, "bola@example.com", "active");
    const main = await ensureMainWallet(ctx, user);
    const tx = arc.simulateDeposit("arb", main.address as Address, 5_000_000n);
    for (let i = 0; i < 40; i++) {
      await sweep(ctx);
      clock.advance(6_000);
    }
    const wallet = await ensureDepositWallet(ctx, user, SOURCE_CHAINS.arb);
    await recordInbound(ctx, { walletId: wallet.providerWalletId, txHash: tx });
    for (let i = 0; i < 6; i++) {
      await sweep(ctx);
      clock.advance(6_000);
    }
    const rows = await ctx.db.select().from(deposits).where(eq(deposits.depositWalletId, wallet.id));
    expect(rows.reduce((sum, d) => sum + BigInt(d.amount), 0n)).toBe(5_000_000n);
    expect(rows.every((d) => d.status === "ready")).toBe(true);
    expect((await notes(ctx)).map((n) => n.key).filter((k) => k.includes("waiting"))).toEqual([]);
    expect(await ctx.chain.usdcBalance(main.address as Address)).toBe(4_999_500n);
  });

  it("waits before trusting a balance Circle hasn't explained yet", async () => {
    const { ctx, clock, arc } = await testCtx();
    const user = await ensureUser(ctx, "bola@example.com", "active");
    const main = await ensureMainWallet(ctx, user);
    arc.simulateDeposit("arb", main.address as Address, 5_000_000n);
    for (let i = 0; i < 10; i++) {
      await sweep(ctx);
      clock.advance(6_000);
    }
    // Under two minutes in: nothing recorded on the balance alone yet.
    expect(await ctx.db.select().from(deposits)).toHaveLength(0);
  });

  it("records a reported deposit at once when the sweeper opened the address first", async () => {
    const { ctx, arc } = await testCtx();
    const user = await ensureUser(ctx, "cara@example.com", "active");
    await ensureMainWallet(ctx, user);
    await sweep(ctx);
    const wallet = await ensureDepositWallet(ctx, user, SOURCE_CHAINS.base);
    const txHash = arc.simulateDeposit("base", wallet.address as Address, 5_000_000n);
    expect(await recordInbound(ctx, { walletId: wallet.providerWalletId, txHash })).toBe("recorded");
  });

  it("names a moved deposit in the person's activity instead of the zero address", async () => {
    const { ctx, arc, clock, user, address } = await setup();
    arc.simulateDeposit("base", address, 5_000_000n);
    await drive(ctx, clock);
    const { received } = await activityFor(ctx, user);
    expect(received.map((r) => [r.amount, r.source, r.fromLabel])).toEqual([["4.9995", "deposit", "Money added"]]);
  });

  it("ignores a report that the chain doesn't back up, and records a real one once (Review Focus 1)", async () => {
    const { ctx, arc, wallet, address } = await setup();
    const other = getAddress("0x00000000000000000000000000000000000000f1");
    const elsewhere = arc.simulateDeposit("base", other, 5_000_000n);
    expect(await recordInbound(ctx, { walletId: wallet.providerWalletId, txHash: elsewhere })).toBe("ignored");
    expect(await recordInbound(ctx, { walletId: wallet.providerWalletId, txHash: pad("0x1234") })).toBe("ignored");
    expect(await recordInbound(ctx, { walletId: "not-a-deposit-wallet", txHash: elsewhere })).toBe("ignored");
    const real = arc.simulateDeposit("base", address, 5_000_000n);
    expect(await recordInbound(ctx, { walletId: wallet.providerWalletId, txHash: real })).toBe("recorded");
    expect(await recordInbound(ctx, { walletId: wallet.providerWalletId, txHash: real })).toBe("duplicate");
    expect(await ctx.db.select().from(deposits)).toHaveLength(1);
  });

  it("burns once when webhooks and sweepers race (Review Focus 2)", async () => {
    const { ctx, arc, clock, mainAddress, wallet, address } = await setup();
    const before = await ctx.chain.usdcBalance(mainAddress);
    const tx = arc.simulateDeposit("base", address, 5_000_000n);
    await Promise.all([recordInbound(ctx, { walletId: wallet.providerWalletId, txHash: tx }), pollDepositWallets(ctx), pollDepositWallets(ctx)]);
    for (let i = 0; i < 12; i++) {
      await Promise.all([advanceDeposits(ctx), advanceDeposits(ctx), advanceDeposits(ctx)]);
      clock.advance(6_000);
    }
    expect(await ctx.db.select().from(depositMoves)).toHaveLength(1);
    expect((await ctx.chain.usdcBalance(mainAddress)) - before).toBe(4_999_500n);
  });

  it("resumes after a crash between sending the burn and saving it, without a second burn (Review Focus 3)", async () => {
    const { ctx, arc, clock, mainAddress, address } = await setup();
    const before = await ctx.chain.usdcBalance(mainAddress);
    arc.simulateDeposit("base", address, 5_000_000n);
    for (let i = 0; i < 12; i++) {
      await pollDepositWallets(ctx);
      await advanceDeposits(ctx);
      const [m] = await ctx.db.select().from(depositMoves);
      if (m?.burnProviderTx) {
        // The process died right after Circle accepted the burn: the row never learned of it.
        await ctx.db.update(depositMoves).set({ burnProviderTx: null }).where(eq(depositMoves.id, m.id));
        break;
      }
      clock.advance(6_000);
    }
    await drive(ctx, clock);
    expect((await ctx.chain.usdcBalance(mainAddress)) - before).toBe(4_999_500n);
    expect((await ctx.db.select().from(depositMoves))[0]!.status).toBe("ready");
  });

  it("finishes when someone else already minted the message (Review Focus 4)", async () => {
    const { ctx, arc, clock, mainAddress, address } = await setup();
    const before = await ctx.chain.usdcBalance(mainAddress);
    arc.simulateDeposit("base", address, 5_000_000n);
    for (let i = 0; i < 12; i++) {
      await pollDepositWallets(ctx);
      await advanceDeposits(ctx);
      const [m] = await ctx.db.select().from(depositMoves);
      if (m?.status === "minting") {
        // Circle's forwarder (or any relayer) gets there first.
        const relay = await ctx.wallets.execute({ walletId: ctx.treasuryWalletId, contract: ctx.crossChain.cctp.messageTransmitter, callData: encodeReceiveMessage(m.message as `0x${string}`, m.attestation as `0x${string}`), idempotencyKey: deterministicUuid("someone-else"), refId: "x" });
        await ctx.wallets.getTx(relay.providerTxId);
        break;
      }
      clock.advance(6_000);
    }
    await drive(ctx, clock);
    expect((await ctx.chain.usdcBalance(mainAddress)) - before).toBe(4_999_500n);
    const [m] = await ctx.db.select().from(depositMoves);
    expect(m!.status).toBe("ready");
    expect(m!.mintedAmount).toBe("4999500");
  });

  it("never calls a deposit ready when its mint failed and nobody else minted it", async () => {
    const { ctx, arc, clock, mainAddress, address } = await setup();
    const transmitter = ctx.crossChain.cctp.messageTransmitter.toLowerCase();
    const wallets = {
      ...ctx.wallets,
      execute: async (input: Parameters<Ctx["wallets"]["execute"]>[0]) =>
        input.contract.toLowerCase() === transmitter ? { providerTxId: "mint-that-fails" } : ctx.wallets.execute(input),
      getTx: async (id: string) => (id === "mint-that-fails" ? { status: "failed" as const, rawState: "FAILED", error: "execution reverted" } : ctx.wallets.getTx(id)),
    };
    const before = await ctx.chain.usdcBalance(mainAddress);
    arc.simulateDeposit("base", address, 5_000_000n);
    await drive({ ...ctx, wallets }, clock);
    expect(await ctx.chain.usdcBalance(mainAddress)).toBe(before);
    const [m] = await ctx.db.select().from(depositMoves);
    expect(m!.status).toBe("minting");
    expect((await ctx.db.select().from(deposits))[0]!.status).toBe("moving");
    expect((await notes(ctx)).map((n) => n.key)).toEqual(["deposit:<id>:arrived"]);
  });

  it("moves on once the burn is confirmed, without waiting for Circle to call it complete", async () => {
    const { ctx, arc, clock, mainAddress, address } = await setup();
    // Circle reports source-chain transactions as CONFIRMED long before COMPLETE; Fast Transfer
    // is attested at that point, so waiting for COMPLETE would waste the speed.
    const wallets = {
      ...ctx.wallets,
      getTx: async (id: string) => {
        const tx = await ctx.wallets.getTx(id);
        return tx.status === "complete" && tx.txHash ? { status: "pending" as const, rawState: "CONFIRMED", txHash: tx.txHash } : tx;
      },
    };
    const before = await ctx.chain.usdcBalance(mainAddress);
    arc.simulateDeposit("base", address, 5_000_000n);
    // The mint on Arc is also only ever CONFIRMED here; its nonce on Arc proves it landed.
    await drive({ ...ctx, wallets }, clock);
    expect((await ctx.chain.usdcBalance(mainAddress)) - before).toBe(4_999_500n);
    expect((await ctx.db.select().from(depositMoves))[0]!.status).toBe("ready");
  });

  it("lets a small deposit wait, then moves it together with the next one", async () => {
    const { ctx, arc, clock, mainAddress, address } = await setup();
    const before = await ctx.chain.usdcBalance(mainAddress);
    arc.simulateDeposit("base", address, 500_000n);
    await drive(ctx, clock, 4);
    expect((await ctx.db.select().from(deposits))[0]!.status).toBe("waiting");
    expect(await notes(ctx)).toEqual([{ key: "deposit:<id>:waiting:<day>", title: "$0.50 arrived", email: "none" }]);

    arc.simulateDeposit("base", address, 700_000n);
    await drive(ctx, clock);
    expect((await ctx.db.select().from(deposits)).map((d) => d.status).sort()).toEqual(["ready", "ready"]);
    expect(await ctx.db.select().from(depositMoves)).toHaveLength(1);
    expect((await ctx.chain.usdcBalance(mainAddress)) - before).toBe(1_200_000n - 120n);
  });

  it("says once when a move is slow, keeps trying, then says when it's ready", async () => {
    const { ctx, arc, clock, address } = await setup();
    const real = ctx.crossChain.iris;
    let attested = false;
    const slow: Iris = { ...real, message: async (d, h) => (attested ? real.message(d, h) : { status: "pending", delayReason: null }) };
    const sctx: Ctx = { ...ctx, crossChain: { ...ctx.crossChain, iris: slow } };
    arc.simulateDeposit("base", address, 5_000_000n);
    await drive(sctx, clock, 4);
    clock.advance(31 * 60_000);
    await drive(sctx, clock, 3);
    attested = true;
    await drive(sctx, clock);
    expect((await notes(ctx)).map((n) => n.key)).toEqual(["deposit:<id>:arrived", "move:<id>:stuck", "move:<id>:ready"]);
    expect((await notes(ctx)).find((n) => n.key === "move:<id>:stuck")).toMatchObject({ title: "Your $5.00 is safe", email: "pending" });
  });

  it("never mints a message addressed to someone else", async () => {
    const { ctx, arc, clock, mainAddress, address } = await setup();
    const real = ctx.crossChain.iris;
    const other = getAddress("0x00000000000000000000000000000000000000f1");
    const tampered: Iris = {
      ...real,
      message: async (d, h) => {
        const m = await real.message(d, h);
        if (m.status !== "complete") return m;
        // Swap the mint recipient inside the burn body (header 148 bytes + 36).
        const hex = m.message.slice(2);
        const at = (148 + 36) * 2;
        return { ...m, message: `0x${hex.slice(0, at)}${pad(other).slice(2)}${hex.slice(at + 64)}` as `0x${string}` };
      },
    };
    const before = await ctx.chain.usdcBalance(mainAddress);
    arc.simulateDeposit("base", address, 5_000_000n);
    await drive({ ...ctx, crossChain: { ...ctx.crossChain, iris: tampered } }, clock);
    expect(await ctx.chain.usdcBalance(mainAddress)).toBe(before);
    expect(await ctx.chain.usdcBalance(other)).toBe(0n);
    expect((await ctx.db.select().from(depositMoves))[0]!.status).not.toBe("ready");
  });

  it("never lets deposits that wait for more hold up anyone else's (final review C1)", async () => {
    const { ctx, arc, clock } = await setup();
    for (let i = 0; i < 11; i++) {
      const u = await ensureUser(ctx, `dust${i}@example.com`, "active");
      await ensureMainWallet(ctx, u);
      const w = await ensureDepositWallet(ctx, u, SOURCE_CHAINS.base);
      arc.simulateDeposit("base", w.address as Address, 1n);
    }
    await drive(ctx, clock, 6);
    // Waiting wallets have nothing to do until more arrives: no slot, not even a balance read.
    let reads = 0;
    const reader = {
      ...ctx.crossChain.reader,
      usdcBalance: (...a: Parameters<Ctx["crossChain"]["reader"]["usdcBalance"]>) => {
        reads++;
        return ctx.crossChain.reader.usdcBalance(...a);
      },
    };
    await advanceDeposits({ ...ctx, crossChain: { ...ctx.crossChain, reader } });
    expect(reads).toBe(0);
    const bola = await ensureUser(ctx, "bola@example.com", "active");
    const bolaMain = await ensureMainWallet(ctx, bola);
    const w = await ensureDepositWallet(ctx, bola, SOURCE_CHAINS.base);
    arc.simulateDeposit("base", w.address as Address, 5_000_000n);
    await drive(ctx, clock);
    expect(await ctx.chain.usdcBalance(bolaMain.address as Address)).toBe(4_999_500n);
  });

  it("moves a new deposit even when an old move burned money nobody recorded (final review I1)", async () => {
    const { ctx, arc, clock, mainAddress, wallet, address } = await setup();
    const before = await ctx.chain.usdcBalance(mainAddress);
    arc.simulateDeposit("base", address, 10_000_000n); // missed: never reported
    const seen = arc.simulateDeposit("base", address, 5_000_000n);
    await recordInbound(ctx, { walletId: wallet.providerWalletId, txHash: seen });
    for (let i = 0; i < 12; i++) {
      await advanceDeposits(ctx);
      clock.advance(6_000);
    }
    const later = arc.simulateDeposit("base", address, 8_000_000n);
    await recordInbound(ctx, { walletId: wallet.providerWalletId, txHash: later });
    await advanceDeposits(ctx);
    // Its money is still on Base: it rides the new move, not the old one.
    const [newMove] = await ctx.db.select().from(depositMoves).where(eq(depositMoves.status, "burning"));
    const [d3] = await ctx.db.select().from(deposits).where(eq(deposits.amount, "8000000"));
    expect(d3!.status).toBe("moving");
    expect(d3!.moveId).toBe(newMove!.id);
    for (let i = 0; i < 12; i++) {
      await advanceDeposits(ctx);
      clock.advance(6_000);
    }
    expect(await ctx.crossChain.reader.usdcBalance(SOURCE_CHAINS.base, address)).toBe(0n);
    expect(await ctx.db.select().from(depositMoves)).toHaveLength(2);
    expect((await ctx.chain.usdcBalance(mainAddress)) - before).toBe(15_000_000n - 1_500n + 8_000_000n - 800n);
  });

  it("burns again when the first burn never stuck on its chain (final review I2)", async () => {
    const { ctx, arc, clock, mainAddress, address } = await setup();
    const messenger = ctx.crossChain.cctp.tokenMessenger.toLowerCase();
    const ghost = pad("0xdead", { size: 32 });
    let first = true;
    const wallets = {
      ...ctx.wallets,
      execute: async (input: Parameters<Ctx["wallets"]["execute"]>[0]) => {
        if (input.contract.toLowerCase() === messenger && first) {
          first = false;
          return { providerTxId: "ghost-burn" };
        }
        return ctx.wallets.execute(input);
      },
      // Circle said CONFIRMED, then a reorg dropped it: no receipt, nothing for Iris to attest.
      getTx: async (id: string) => (id === "ghost-burn" ? { status: "pending" as const, rawState: "CONFIRMED", txHash: ghost } : ctx.wallets.getTx(id)),
    };
    const gctx = { ...ctx, wallets };
    const before = await ctx.chain.usdcBalance(mainAddress);
    arc.simulateDeposit("base", address, 5_000_000n);
    await drive(gctx, clock, 4);
    expect((await ctx.db.select().from(depositMoves))[0]!.status).toBe("attesting");
    clock.advance(16 * 60_000);
    await drive(gctx, clock, 30);
    expect((await ctx.chain.usdcBalance(mainAddress)) - before).toBe(4_999_500n);
    expect((await ctx.db.select().from(depositMoves))[0]!.status).toBe("ready");
  });

  it("never burns again when one node can't find a burn whose money left (audit 2026-10-28)", async () => {
    const { ctx, arc, clock, mainAddress, address } = await setup();
    const messenger = ctx.crossChain.cctp.tokenMessenger.toLowerCase();
    // Distinct burns, by key: a step re-sends the same burn with the same key while it waits.
    const burnKeys = new Set<string>();
    const wallets = {
      ...ctx.wallets,
      execute: async (input: Parameters<Ctx["wallets"]["execute"]>[0]) => {
        if (input.contract.toLowerCase() === messenger) burnKeys.add(input.idempotencyKey);
        return ctx.wallets.execute(input);
      },
    };
    // A lagging node: no receipt for the burn, though it landed and took the money.
    const reader = { ...ctx.crossChain.reader, receiptStatus: async () => null };
    const lagging = { ...ctx, wallets, crossChain: { ...ctx.crossChain, reader } };
    const before = await ctx.chain.usdcBalance(mainAddress);
    arc.irisHold = "missing";
    arc.simulateDeposit("base", address, 5_000_000n);
    await drive(lagging, clock, 4);
    clock.advance(16 * 60_000);
    await drive(lagging, clock, 6);
    expect(burnKeys.size).toBe(1);
    expect((await ctx.db.select().from(depositMoves))[0]).toMatchObject({ status: "attesting", lastError: expect.stringMatching(/^burn unconfirmed/) });
    arc.irisHold = null;
    await drive(lagging, clock, 10);
    expect(burnKeys.size).toBe(1);
    expect((await ctx.chain.usdcBalance(mainAddress)) - before).toBe(4_999_500n);
  });

  it("ends a move that keeps failing, frees the address, and carries its deposit with the next one", async () => {
    const { ctx, arc, clock, mainAddress, address } = await setup();
    const usdc = SOURCE_CHAINS.base.usdc[ctx.crossChain.network].toLowerCase();
    let failing = true;
    const wallets = {
      ...ctx.wallets,
      execute: async (input: Parameters<Ctx["wallets"]["execute"]>[0]) =>
        failing && input.contract.toLowerCase() === usdc ? { providerTxId: `no-gas-${input.idempotencyKey}` } : ctx.wallets.execute(input),
      getTx: async (id: string) => (id.startsWith("no-gas-") ? { status: "failed" as const, rawState: "FAILED", error: "gas policy inactive" } : ctx.wallets.getTx(id)),
    };
    const flaky = { ...ctx, wallets };
    const before = await ctx.chain.usdcBalance(mainAddress);
    arc.simulateDeposit("base", address, 5_000_000n);
    await drive(flaky, clock, 10);
    for (let h = 0; h < 6; h++) {
      clock.advance(60 * 60_000);
      await drive(flaky, clock, 1);
    }
    expect((await ctx.db.select().from(depositMoves))[0]!.status).toBe("stuck");
    expect((await ctx.db.select().from(deposits)).map((d) => d.status)).toEqual(["waiting"]);

    failing = false;
    arc.simulateDeposit("base", address, 1_000_000n);
    await drive(flaky, clock, 20);
    const moves = await ctx.db.select().from(depositMoves);
    expect(moves.map((m) => m.status).sort()).toEqual(["ready", "stuck"]);
    expect(moves.find((m) => m.status === "ready")!.burnAmount).toBe("6000000");
    expect((await ctx.db.select().from(deposits)).map((d) => d.status)).toEqual(["ready", "ready"]);
    expect((await ctx.chain.usdcBalance(mainAddress)) - before).toBeGreaterThan(5_990_000n);
  });

  it("a move that goes stuck remembers the step it stopped at", async () => {
    const { ctx, arc, clock, address } = await setup();
    const transmitter = ctx.crossChain.cctp.messageTransmitter.toLowerCase();
    // The burn goes through; the mint on Arc keeps failing.
    const wallets = {
      ...ctx.wallets,
      execute: async (input: Parameters<Ctx["wallets"]["execute"]>[0]) =>
        input.contract.toLowerCase() === transmitter ? { providerTxId: `no-mint-${input.idempotencyKey}` } : ctx.wallets.execute(input),
      getTx: async (id: string) => (id.startsWith("no-mint-") ? { status: "failed" as const, rawState: "FAILED", error: "out of gas" } : ctx.wallets.getTx(id)),
    };
    const flaky = { ...ctx, wallets };
    arc.simulateDeposit("base", address, 5_000_000n);
    await drive(flaky, clock, 10);
    for (let h = 0; h < 10; h++) {
      clock.advance(60 * 60_000);
      await drive(flaky, clock, 1);
    }
    const [move] = await ctx.db.select().from(depositMoves);
    expect(move!.status).toBe("stuck");
    expect(move!.resumeStatus).toBe("minting");
  });

  it("a restart by support sends a new mint instead of replaying the failed ones, and lands", async () => {
    const { ctx, arc, clock, user, address } = await setup();
    const transmitter = ctx.crossChain.cctp.messageTransmitter.toLowerCase();
    const mintKeys: string[] = [];
    let failing = true;
    const wallets = {
      ...ctx.wallets,
      execute: async (input: Parameters<Ctx["wallets"]["execute"]>[0]) => {
        if (input.contract.toLowerCase() !== transmitter) return ctx.wallets.execute(input);
        mintKeys.push(input.idempotencyKey);
        return failing ? { providerTxId: `no-mint-${input.idempotencyKey}` } : ctx.wallets.execute(input);
      },
      getTx: async (id: string) => (id.startsWith("no-mint-") ? { status: "failed" as const, rawState: "FAILED", error: "out of gas" } : ctx.wallets.getTx(id)),
    };
    const flaky = { ...ctx, wallets };
    arc.simulateDeposit("base", address, 5_000_000n);
    await drive(flaky, clock, 10);
    for (let h = 0; h < 10; h++) {
      clock.advance(60 * 60_000);
      await drive(flaky, clock, 1);
    }
    expect((await ctx.db.select().from(depositMoves))[0]!.status).toBe("stuck");
    const failed = new Set(mintKeys);

    failing = false;
    expect((await runTool(flaky, user, "retry_deposit", { ref: "latest" })).ok).toBe(true);
    await drive(flaky, clock, 6);
    const [move] = await ctx.db.select().from(depositMoves);
    expect(move).toMatchObject({ status: "ready", resumes: 1 });
    expect(mintKeys.filter((k) => !failed.has(k)).length).toBeGreaterThan(0);
  });

  it("backs off a step that keeps failing instead of sending a new transaction every sweep (final review I3)", async () => {
    const { ctx, arc, clock, address } = await setup();
    const usdc = SOURCE_CHAINS.base.usdc[ctx.crossChain.network].toLowerCase();
    let approvals = 0;
    const wallets = {
      ...ctx.wallets,
      execute: async (input: Parameters<Ctx["wallets"]["execute"]>[0]) => {
        if (input.contract.toLowerCase() !== usdc) return ctx.wallets.execute(input);
        approvals++;
        return { providerTxId: `no-gas-${input.idempotencyKey}` };
      },
      getTx: async (id: string) => (id.startsWith("no-gas-") ? { status: "failed" as const, rawState: "FAILED", error: "gas policy inactive" } : ctx.wallets.getTx(id)),
    };
    arc.simulateDeposit("base", address, 5_000_000n);
    // Ten minutes of sweeps, one every six seconds.
    await drive({ ...ctx, wallets }, clock, 100);
    expect(approvals).toBeLessThanOrEqual(6);
    // And it stops after a few hours instead of trying forever.
    for (let h = 0; h < 48; h++) {
      clock.advance(60 * 60_000);
      await drive({ ...ctx, wallets }, clock, 1);
    }
    expect(approvals).toBeLessThanOrEqual(9);
  });

  it("still finds a deposit to an older address, just less often (final review I4)", async () => {
    const { ctx, arc, clock, mainAddress, address } = await setup();
    const before = await ctx.chain.usdcBalance(mainAddress);
    clock.advance(8 * 24 * 60 * 60_000);
    arc.simulateDeposit("base", address, 5_000_000n);
    clock.advance(61 * 60_000);
    await drive(ctx, clock);
    expect((await ctx.chain.usdcBalance(mainAddress)) - before).toBe(4_999_500n);
  });

  it("tells a person about deposits that wait at most once a day, in the app only (final review I5)", async () => {
    const { ctx, arc, clock, address } = await setup();
    for (let i = 0; i < 5; i++) arc.simulateDeposit("base", address, 1n);
    await drive(ctx, clock, 6);
    expect(await notes(ctx)).toEqual([{ key: "deposit:<id>:waiting:<day>", title: "$0.00 arrived", email: "none" }]);
  });

  it("doesn't read the chain again for a deposit it already has (final review I6)", async () => {
    const { ctx, arc, wallet, address } = await setup();
    let reads = 0;
    const reader = {
      ...ctx.crossChain.reader,
      verifyInbound: (...a: Parameters<Ctx["crossChain"]["reader"]["verifyInbound"]>) => {
        reads++;
        return ctx.crossChain.reader.verifyInbound(...a);
      },
    };
    const rctx = { ...ctx, crossChain: { ...ctx.crossChain, reader } };
    const tx = arc.simulateDeposit("base", address, 5_000_000n);
    await recordInbound(rctx, { walletId: wallet.providerWalletId, txHash: tx });
    expect(await recordInbound(rctx, { walletId: wallet.providerWalletId, txHash: tx })).toBe("duplicate");
    expect(reads).toBe(1);
  });
});
