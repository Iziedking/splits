import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { testCtx } from "../testing";
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
});
