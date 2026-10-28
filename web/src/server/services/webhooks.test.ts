import { generateKeyPairSync, sign } from "node:crypto";
import { keccak256, stringToHex } from "viem";
import { describe, expect, it } from "vitest";
import { SOURCE_CHAINS } from "../crosschain/chains";
import { deposits, transfers } from "../db/schema";
import { signedInUser, testCtx } from "../testing";
import { ensureDepositWallet } from "./depositWallets";
import { ensureUser } from "./users";
import { handleCircleWebhook, verifyCircleSignature } from "./webhooks";

// Published sample from developers.circle.com/wallets/webhook-notifications (checked 2026-10-11).
const CIRCLE_PUBLIC_KEY =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESl76SZPBJemW0mJNN4KTvYkLT8bOT4UGhFhzNk3fJqf6iuPlLQLq533FelXwczJbjg2U1PHTvQTK7qOQnDL2Tg==";
const CIRCLE_SIGNATURE =
  "MEQCIBlJPX7t0FDOcozsRK6qIQwik5Fq6mhAtCSSgIB/yQO7AiB9U5lVpdufKvPhk3cz4TH2f5MP7ArnmPRBmhPztpsIFQ==";
const CIRCLE_MESSAGE =
  '{"subscriptionId":"00000000-0000-0000-0000-000000000000","notificationId":"00000000-0000-0000-0000-000000000000","notificationType":"webhooks.test","notification":{"hello":"world"},"timestamp":"2024-01-26T18:22:19.779834211Z","version":2}';

describe("Circle webhook signatures", () => {
  it("accepts Circle's published sample", () => {
    expect(verifyCircleSignature(CIRCLE_MESSAGE, CIRCLE_SIGNATURE, CIRCLE_PUBLIC_KEY)).toBe(true);
  });

  it("rejects a body changed by one character", () => {
    expect(verifyCircleSignature(CIRCLE_MESSAGE.replace("world", "World"), CIRCLE_SIGNATURE, CIRCLE_PUBLIC_KEY)).toBe(false);
  });

  it("rejects garbage keys and signatures without throwing", () => {
    expect(verifyCircleSignature(CIRCLE_MESSAGE, "bm9wZQ==", CIRCLE_PUBLIC_KEY)).toBe(false);
    expect(verifyCircleSignature(CIRCLE_MESSAGE, CIRCLE_SIGNATURE, "bm9wZQ==")).toBe(false);
  });
});

describe("Circle webhook handling", () => {
  function signer() {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    return { spki, sign: (body: string) => sign("sha256", Buffer.from(body), privateKey).toString("base64") };
  }

  it("refuses unsigned and badly signed requests", async () => {
    const { ctx } = await testCtx();
    const keys = signer();
    const live = { ...ctx, webhookKey: async () => keys.spki };
    const body = JSON.stringify({ notificationId: "n1", notificationType: "webhooks.test", notification: {} });
    await expect(handleCircleWebhook(live, body, { signature: null, keyId: null })).rejects.toMatchObject({
      code: "WEBHOOK_UNSIGNED",
    });
    await expect(
      handleCircleWebhook(live, body, { signature: keys.sign(body + " "), keyId: "k" }),
    ).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE" });
  });

  it("processes a notification once and reports replays as duplicates", async () => {
    const { ctx } = await testCtx();
    const keys = signer();
    const live = { ...ctx, webhookKey: async () => keys.spki };
    const body = JSON.stringify({ notificationId: "n2", notificationType: "webhooks.test", notification: {} });
    const headers = { signature: keys.sign(body), keyId: "k" };
    expect(await handleCircleWebhook(live, body, headers)).toBe("ignored");
    expect(await handleCircleWebhook(live, body, headers)).toBe("duplicate");
  });

  it("records a verified deposit on another chain, and never runs Arc rules for it", async () => {
    const { ctx, arc } = await testCtx();
    const keys = signer();
    const live = { ...ctx, webhookKey: async () => keys.spki };
    const user = await ensureUser(ctx, "ada@example.com", "active");
    const wallet = await ensureDepositWallet(ctx, user, SOURCE_CHAINS.base);
    const txHash = arc.simulateDeposit("base", wallet.address as `0x${string}`, 5_000_000n);
    const body = JSON.stringify({
      notificationId: "n3",
      notificationType: "transactions.inbound",
      // Deposits start at CONFIRMED: they are verified on chain anyway.
      notification: { id: "c1", walletId: wallet.providerWalletId, blockchain: "BASE-SEPOLIA", state: "CONFIRMED", amounts: ["5"], txHash },
    });
    expect(await handleCircleWebhook(live, body, { signature: keys.sign(body), keyId: "k" })).toBe("processed");
    const rows = await ctx.db.select().from(deposits);
    expect(rows.map((d) => [d.status, d.amount])).toEqual([["detected", "5000000"]]);
    expect(await ctx.db.select().from(transfers)).toHaveLength(0);
  });
  it("starts no rule for money from the treasury or another Splits wallet, only from outside", async () => {
    const { ctx } = await testCtx();
    const keys = signer();
    const live = { ...ctx, webhookKey: async () => keys.spki };
    const { wallet } = await signedInUser(ctx, "ada@example.com");
    const { wallet: other } = await signedInUser(ctx, "bea@example.com");
    const deliver = (id: string, sourceAddress: string) => {
      const body = JSON.stringify({
        notificationId: id,
        notificationType: "transactions.inbound",
        notification: { id, walletId: wallet.providerWalletId, blockchain: "ARC-TESTNET", state: "COMPLETE", amounts: ["5"], txHash: keccak256(stringToHex(id)), sourceAddress },
      });
      return handleCircleWebhook(live, body, { signature: keys.sign(body), keyId: "k" });
    };
    expect(await deliver("top-up", ctx.treasuryAddress)).toBe("ignored");
    expect(await deliver("own-move", other.address.toLowerCase())).toBe("ignored");
    expect(await deliver("from-outside", "0x00000000000000000000000000000000000000ee")).toBe("processed");
  });

  it("lets Circle deliver a deposit again when its chain couldn't be read (final review I4)", async () => {
    const { ctx, arc } = await testCtx();
    const keys = signer();
    const user = await ensureUser(ctx, "ada@example.com", "active");
    const wallet = await ensureDepositWallet(ctx, user, SOURCE_CHAINS.base);
    const txHash = arc.simulateDeposit("base", wallet.address as `0x${string}`, 5_000_000n);
    let down = true;
    const reader = {
      ...ctx.crossChain.reader,
      verifyInbound: async (...args: Parameters<typeof ctx.crossChain.reader.verifyInbound>) => {
        if (down) throw new Error("RPC timeout");
        return ctx.crossChain.reader.verifyInbound(...args);
      },
    };
    const live = { ...ctx, webhookKey: async () => keys.spki, crossChain: { ...ctx.crossChain, reader } };
    const body = JSON.stringify({
      notificationId: "n4",
      notificationType: "transactions.inbound",
      notification: { id: "c2", walletId: wallet.providerWalletId, blockchain: "BASE-SEPOLIA", state: "CONFIRMED", amounts: ["5"], txHash },
    });
    await expect(handleCircleWebhook(live, body, { signature: keys.sign(body), keyId: "k" })).rejects.toThrow("RPC timeout");
    down = false;
    expect(await handleCircleWebhook(live, body, { signature: keys.sign(body), keyId: "k" })).toBe("processed");
    expect(await ctx.db.select().from(deposits)).toHaveLength(1);
  });
});
