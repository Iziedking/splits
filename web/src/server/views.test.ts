import { describe, expect, it } from "vitest";
import { walletsFor } from "./services/users";
import { signedInUser, testCtx } from "./testing";
import { meView } from "./views";

describe("the /api/me view", () => {
  // The live-mainnet default (off unless FUNDING_ENABLED is set) is proven in config.test.ts.
  it("tells the client whether the test card is on", async () => {
    const on = await testCtx({ FUNDING_ENABLED: "true" });
    const ada = await signedInUser(on.ctx, "ada@example.com");
    const withCard = meView(on.ctx, ada.user, false, await walletsFor(on.ctx, ada.user.id));
    expect(withCard.demoCard).toBe(true);
    expect(withCard.mode).toBe("preview");
    expect(withCard.user.email).toBe("ada@example.com");
    expect(withCard.wallets.some((w) => w.kind === "main")).toBe(true);
    expect(withCard.limits).toEqual({ perPayment: expect.stringMatching(/^\d+\.\d{2}$/), daily: expect.stringMatching(/^\d+\.\d{2}$/) });

    const off = await testCtx({ FUNDING_ENABLED: "false" });
    const bola = await signedInUser(off.ctx, "bola@example.com");
    expect(meView(off.ctx, bola.user, true, await walletsFor(off.ctx, bola.user.id)).demoCard).toBe(false);
  });
});
