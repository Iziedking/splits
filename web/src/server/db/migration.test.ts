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
});
