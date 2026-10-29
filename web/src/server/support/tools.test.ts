import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reference } from "@/lib/support";
import { STATUS_LABEL } from "@/lib/format";
import type { Ctx } from "../context";
import { depositMoves, deposits, depositWallets, notifications, transfers } from "../db/schema";
import { testCtx } from "../testing";
import type { Transfer } from "../services/transfers";
import { ensureMainWallet, ensureUser, type User } from "../services/users";
import { runTool, TOOL_NAMES, TOOLS } from "./tools";

const transfersModule = vi.hoisted(() => ({ advance: vi.fn() }));
vi.mock("../services/transfers", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/transfers")>();
  return { ...original, advanceTransfer: transfersModule.advance };
});

let seq = 0;
const NETWORKS = ["base", "arb", "op", "matic", "avax"];

async function setup() {
  const t = await testCtx();
  const ada = await ensureUser(t.ctx, "ada@example.com", "active");
  const bo = await ensureUser(t.ctx, "bo@example.com", "active");
  return { ...t, ada, bo };
}

async function payment(ctx: Ctx, user: User, over: Partial<Transfer> = {}): Promise<Transfer> {
  const wallet = await ensureMainWallet(ctx, user);
  seq++;
  const [t] = await ctx.db
    .insert(transfers)
    .values({
      payerUserId: user.id,
      payerWalletId: wallet.id,
      payerAddress: wallet.address,
      kind: "pay",
      amount: "30000000",
      expected: [{ name: "Landlord", address: "0x00000000000000000000000000000000000000f1", amount: "30000000", purpose: "rent", email: null }],
      ref: `ref-${seq}`,
      status: "sending",
      createdAt: new Date(Date.UTC(2026, 9, 12, 8, seq)),
      ...over,
    })
    .returning();
  return t!;
}

/** A deposit wallet with one deposit and the move that carried (or tried to carry) it. */
async function stuckDeposit(ctx: Ctx, user: User, move: { burnTxHash?: string | null; mintTxHash?: string | null; resumeStatus?: "burning" | "attesting" | "minting" | null }) {
  seq++;
  // One deposit address per person per network, so each fixture takes the next network.
  const chain = NETWORKS[seq % NETWORKS.length]!;
  const [wallet] = await ctx.db
    .insert(depositWallets)
    .values({ userId: user.id, chain, providerWalletId: `pw-${seq}`, address: `0x${seq.toString(16).padStart(40, "0")}` })
    .returning();
  const [m] = await ctx.db
    .insert(depositMoves)
    .values({
      depositWalletId: wallet!.id,
      userId: user.id,
      chain,
      status: "stuck",
      burnAmount: "5000000",
      burnTxHash: move.burnTxHash ?? null,
      mintTxHash: move.mintTxHash ?? null,
      resumeStatus: move.resumeStatus === undefined ? "minting" : move.resumeStatus,
      attempts: 8,
      lastError: "mint failed",
    })
    .returning();
  // A move stuck before its burn lets go of its deposits (they wait, unattached); after the burn they stay on it.
  const beforeBurn = !move.burnTxHash;
  const [d] = await ctx.db
    .insert(deposits)
    .values({
      userId: user.id,
      depositWalletId: wallet!.id,
      chain,
      sourceTxId: `base:0x${seq}`,
      sourceTxHash: `0x${seq}`,
      amount: "5000000",
      status: beforeBurn ? "waiting" : "moving",
      moveId: beforeBurn ? null : m!.id,
    })
    .returning();
  return { wallet: wallet!, move: m!, deposit: d! };
}

beforeEach(() => {
  transfersModule.advance.mockReset();
  transfersModule.advance.mockImplementation(async (ctx: Ctx, id: string) => {
    const [t] = await ctx.db.select().from(transfers).where(eq(transfers.id, id));
    return t;
  });
});

describe("the support agent's tools", () => {
  it("registry is exactly the seven tools", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES).toEqual(["list_payments", "get_payment", "list_deposits", "recheck_payment", "retry_deposit", "resend_receipts", "hand_over"]);
  });

  it("get_payment finds only the caller's payment", async () => {
    const { ctx, ada, bo } = await setup();
    const t = await payment(ctx, ada);
    const mine = await runTool(ctx, ada, "get_payment", { ref: reference(t.id) });
    expect(mine.ok).toBe(true);
    expect(mine.text).toContain(STATUS_LABEL.sending!);
    expect(await runTool(ctx, bo, "get_payment", { ref: reference(t.id) })).toEqual({ ok: false, text: "No payment with that reference on your account." });
  });

  it('"latest" resolves to the caller\'s newest payment', async () => {
    const { ctx, ada } = await setup();
    await payment(ctx, ada, { status: "failed" });
    const newest = await payment(ctx, ada, { status: "settled" });
    const res = await runTool(ctx, ada, "get_payment", { ref: "latest" });
    expect(res.text).toContain(reference(newest.id));
    expect(res.text).toContain(STATUS_LABEL.settled);
  });

  it("references are matched ignoring case and spaces", async () => {
    const { ctx, ada } = await setup();
    const t = await payment(ctx, ada);
    const spaced = reference(t.id).toLowerCase().replace(/(.{4})/g, "$1 ").trim();
    expect((await runTool(ctx, ada, "get_payment", { ref: spaced })).ok).toBe(true);
  });

  it("unknown tool or bad input is refused, not thrown", async () => {
    const { ctx, ada } = await setup();
    expect((await runTool(ctx, ada, "send_money", {})).ok).toBe(false);
    expect((await runTool(ctx, ada, "get_payment", { ref: "'; drop table" })).ok).toBe(false);
    expect((await runTool(ctx, ada, "get_payment", null)).ok).toBe(false);
  });

  it("list_payments with none says so", async () => {
    const { ctx, ada } = await setup();
    expect(await runTool(ctx, ada, "list_payments", {})).toEqual({ ok: true, text: "You haven't made any payments yet." });
    expect(await runTool(ctx, ada, "list_deposits", {})).toEqual({ ok: true, text: "No money has been added from another network yet." });
  });

  it("list_payments shows only the caller's payments, newest first", async () => {
    const { ctx, ada, bo } = await setup();
    const a1 = await payment(ctx, ada);
    const a2 = await payment(ctx, ada, { status: "settled" });
    const b = await payment(ctx, bo);
    const res = await runTool(ctx, ada, "list_payments", {});
    expect(res.text.indexOf(reference(a2.id))).toBeLessThan(res.text.indexOf(reference(a1.id)));
    expect(res.text).not.toContain(reference(b.id));
  });

  it("recheck_payment leaves settled and failed payments alone", async () => {
    const { ctx, ada } = await setup();
    for (const status of ["settled", "failed"] as const) {
      const t = await payment(ctx, ada, { status });
      const res = await runTool(ctx, ada, "recheck_payment", { ref: reference(t.id) });
      expect(res.text).toContain("already");
    }
    expect(transfersModule.advance).not.toHaveBeenCalled();
  });

  it("recheck reports the status after advancing", async () => {
    const { ctx, ada } = await setup();
    const t = await payment(ctx, ada);
    transfersModule.advance.mockImplementationOnce(async (c: Ctx, id: string) => {
      const [done] = await c.db.update(transfers).set({ status: "settled" }).where(eq(transfers.id, id)).returning();
      return done;
    });
    const res = await runTool(ctx, ada, "recheck_payment", { ref: reference(t.id) });
    expect(res).toEqual({ ok: true, text: expect.stringContaining(STATUS_LABEL.settled!) });
    expect(transfersModule.advance).toHaveBeenCalledWith(ctx, t.id, 10_000);
    // Settled through the agent, it's still news: the payer is told, as on the payment page.
    expect((await ctx.db.select().from(notifications)).some((n) => n.userId === ada.id)).toBe(true);
  });

  it("recheck_payment is limited to 3 per payment per hour", async () => {
    const { ctx, ada } = await setup();
    const t = await payment(ctx, ada);
    for (let i = 0; i < 3; i++) expect((await runTool(ctx, ada, "recheck_payment", { ref: reference(t.id) })).ok).toBe(true);
    const fourth = await runTool(ctx, ada, "recheck_payment", { ref: reference(t.id) });
    expect(fourth.ok).toBe(false);
    expect(fourth.text).toMatch(/\d\d:\d\d UTC/);
  });

  it("retry_deposit after burn resumes the move", async () => {
    const { ctx, ada } = await setup();
    const { move, deposit } = await stuckDeposit(ctx, ada, { burnTxHash: "0xburn", resumeStatus: "minting" });
    const res = await runTool(ctx, ada, "retry_deposit", { ref: reference(deposit.id) });
    expect(res.ok).toBe(true);
    const [after] = await ctx.db.select().from(depositMoves).where(eq(depositMoves.id, move.id));
    expect(after).toMatchObject({ status: "minting", attempts: 0, lastError: null, resumes: 1 });
  });

  it("retry_deposit before burn re-queues the deposits", async () => {
    const { ctx, ada } = await setup();
    const { deposit } = await stuckDeposit(ctx, ada, { burnTxHash: null, resumeStatus: "burning" });
    const res = await runTool(ctx, ada, "retry_deposit", { ref: reference(deposit.id) });
    expect(res.ok).toBe(true);
    const [after] = await ctx.db.select().from(deposits).where(eq(deposits.id, deposit.id));
    expect(after!.status).toBe("detected");
  });

  it("retry_deposit refuses what it can't safely restart", async () => {
    const { ctx, ada } = await setup();
    const landed = await stuckDeposit(ctx, ada, { burnTxHash: "0xburn", mintTxHash: "0xmint" });
    const unknownStep = await stuckDeposit(ctx, ada, { burnTxHash: "0xburn", resumeStatus: null });
    const once = await stuckDeposit(ctx, ada, { burnTxHash: "0xburn", resumeStatus: "attesting" });
    const busy = await stuckDeposit(ctx, ada, { burnTxHash: "0xburn", resumeStatus: "minting" });
    await ctx.db.insert(depositMoves).values({ depositWalletId: busy.wallet.id, userId: ada.id, chain: busy.wallet.chain, status: "burning", burnAmount: "1000000" });

    expect((await runTool(ctx, ada, "retry_deposit", { ref: reference(once.deposit.id) })).ok).toBe(true);
    // Put it back to stuck: a second try the same day is still refused.
    await ctx.db.update(depositMoves).set({ status: "stuck" }).where(eq(depositMoves.id, once.move.id));
    for (const d of [landed, unknownStep, once, busy]) {
      const res = await runTool(ctx, ada, "retry_deposit", { ref: reference(d.deposit.id) });
      expect(res.ok).toBe(false);
      expect(res.text).toMatch(/person/);
    }
  });

  it("list_deposits says when a deposit has stopped, before or after its burn", async () => {
    const { ctx, ada } = await setup();
    const after = await stuckDeposit(ctx, ada, { burnTxHash: "0xburn", resumeStatus: "minting" });
    const before = await stuckDeposit(ctx, ada, { burnTxHash: null, resumeStatus: "burning" });
    const lines = (await runTool(ctx, ada, "list_deposits", {})).text.split("\n");
    for (const d of [after, before]) expect(lines.find((l) => l.startsWith(reference(d.deposit.id)))).toContain("Stopped on its way to your balance");
  });

  it("retry_deposit can't touch someone else's deposit", async () => {
    const { ctx, ada, bo } = await setup();
    const { deposit } = await stuckDeposit(ctx, ada, { burnTxHash: "0xburn", resumeStatus: "minting" });
    expect(await runTool(ctx, bo, "retry_deposit", { ref: reference(deposit.id) })).toEqual({ ok: false, text: "No deposit with that reference on your account." });
  });

  it("resend_receipts sends only to the account email", async () => {
    const { ctx, ada } = await setup();
    const settled = await payment(ctx, ada, { status: "settled" });
    const pending = await payment(ctx, ada);
    expect((await runTool(ctx, ada, "resend_receipts", { ref: reference(settled.id) })).ok).toBe(true);
    expect(ctx.previewEmail!.receipts).toEqual([{ to: "ada@example.com", amount: "30.00", url: `${ctx.appUrl}/payments/${settled.id}` }]);
    expect((await runTool(ctx, ada, "resend_receipts", { ref: reference(pending.id) })).ok).toBe(false);
    expect((await runTool(ctx, ada, "resend_receipts", { ref: reference(settled.id) })).ok).toBe(false);
    expect(ctx.previewEmail!.receipts).toHaveLength(1);
  });

  it("hand_over is left to the chat", async () => {
    const { ctx, ada } = await setup();
    expect(await runTool(ctx, ada, "hand_over", { summary: "x" })).toEqual({ ok: false, text: "handled by chat" });
  });
});
