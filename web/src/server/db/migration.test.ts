import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Applies migrations up to 0003, writes payments the way the old code did, then applies the rest:
 * existing payments must come out with a payer address and the right funding kind.
 */
describe("migration 0004", () => {
  it("backfills payer_address and funding on existing payments", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const full = path.join(process.cwd(), "drizzle");
    const early = mkdtempSync(path.join(tmpdir(), "splits-mig-"));
    try {
      cpSync(full, early, { recursive: true });
      const journalPath = path.join(early, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8"));
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 3);
      writeFileSync(journalPath, JSON.stringify(journal));

      const client = new PGlite();
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: early });
      await client.exec(`
        insert into users (id, email, status) values ('00000000-0000-4000-8000-000000000001', 'a@example.com', 'active');
        insert into wallets (id, user_id, kind, label, provider_wallet_id, address)
          values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'main', 'Main', 'pw1', '0xAbC0000000000000000000000000000000000001');
        insert into transfers (id, payer_user_id, payer_wallet_id, kind, amount, top_up, expected, ref, status)
          values ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'pay', '5000000', '5000000', '[]', '0x01', 'settled'),
                 ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'pay', '5000000', '0', '[]', '0x02', 'settled');
      `);
      await migrate(db, { migrationsFolder: full });
      const { rows } = await client.query<{ id: string; payer_address: string; funding: string; fee_amount: string }>(
        "select id, payer_address, funding, fee_amount from transfers order by id",
      );
      expect(rows).toEqual([
        { id: "00000000-0000-4000-8000-000000000003", payer_address: "0xAbC0000000000000000000000000000000000001", funding: "card", fee_amount: "0" },
        { id: "00000000-0000-4000-8000-000000000004", payer_address: "0xAbC0000000000000000000000000000000000001", funding: "balance", fee_amount: "0" },
      ]);
      await client.close();
    } finally {
      rmSync(early, { recursive: true, force: true });
    }
  });

  it("indexes payer addresses case-insensitively, so the send limit can use it", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const client = new PGlite();
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    const { rows } = await client.query<{ indexdef: string }>("select indexdef from pg_indexes where tablename = 'transfers'");
    expect(rows.some((r) => /lower\(payer_address\)/.test(r.indexdef))).toBe(true);
    await client.close();
  });
});

/** Payments made before 0014 get the tag their payer held at the time, or none if they had none yet. */
describe("migration 0014", () => {
  it("backfills each payment's payer tag from the tag held when it was made", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const full = path.join(process.cwd(), "drizzle");
    const early = mkdtempSync(path.join(tmpdir(), "splits-mig-"));
    try {
      cpSync(full, early, { recursive: true });
      const journalPath = path.join(early, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8"));
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 13);
      writeFileSync(journalPath, JSON.stringify(journal));

      const client = new PGlite();
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: early });
      const user = "00000000-0000-4000-8000-000000000001";
      const pay = (id: string, at: string) =>
        `insert into transfers (id, payer_user_id, payer_address, kind, amount, expected, ref, status, created_at)
           values ('${id}', '${user}', '0xAbC0000000000000000000000000000000000001', 'pay', '5000000', '[]', '${id}', 'settled', '${at}');`;
      await client.exec(`
        insert into users (id, email, status, tag, tag_changes) values ('${user}', 'a@example.com', 'active', 'ada_new', 1);
        insert into split_tags (tag, user_id, claimed_at, retired_at) values
          ('ada', '${user}', '2026-10-29T10:00:00Z', '2026-10-29T12:00:00Z'),
          ('ada_new', '${user}', '2026-10-29T12:00:00Z', null);
        ${pay("00000000-0000-4000-8000-00000000000a", "2026-10-28T09:00:00Z")}
        ${pay("00000000-0000-4000-8000-00000000000b", "2026-10-29T11:00:00Z")}
        ${pay("00000000-0000-4000-8000-00000000000c", "2026-10-29T13:00:00Z")}
      `);
      await migrate(db, { migrationsFolder: full });
      const { rows } = await client.query<{ payer_tag: string | null }>("select payer_tag from transfers order by id");
      expect(rows.map((r) => r.payer_tag)).toEqual([null, "ada", "ada_new"]);
      const { rows: idx } = await client.query<{ indexdef: string }>("select indexdef from pg_indexes where indexname = 'users_tag_prefix'");
      expect(idx[0]?.indexdef).toMatch(/text_pattern_ops/);
      await client.close();
    } finally {
      rmSync(early, { recursive: true, force: true });
    }
  });
});
