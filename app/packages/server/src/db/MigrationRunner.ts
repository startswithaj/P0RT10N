/// <reference lib="deno.ns" />
import { readMigrationFiles } from "drizzle-orm/migrator";
import { resolve } from "node:path";
import type { DatabaseDriver } from "./driver.ts";
import type { Logger } from "../services/types.ts";

/** Path to the generated drizzle migrations folder, resolved from cwd. */
const MIGRATIONS_FOLDER = resolve(Deno.cwd(), "drizzle");

/**
 * Apply generated Drizzle migrations directly via @db/sqlite. Tracks applied
 * migrations by hash (not timestamp — @db/sqlite v0.12 truncates integers
 * > 2^31, which historically re-populated the journal every boot). Both the app
 * boot path and the tests call this, so there is one source of truth. (Ported
 * from chargeHA.)
 */
export function runMigrations(sqlite: DatabaseDriver, logger?: Logger): void {
  const migrations = readMigrationFiles({
    migrationsFolder: MIGRATIONS_FOLDER,
  });

  sqlite.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);

  const rows = sqlite.prepare("SELECT hash FROM __drizzle_migrations")
    .all() as { hash: string }[];
  const applied = new Set(rows.map((r) => r.hash));

  const insert = sqlite.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );

  migrations
    .filter((migration) => !applied.has(migration.hash))
    .forEach((migration) => {
      migration.sql.forEach((stmt) => sqlite.exec(stmt));
      insert.run(migration.hash, String(migration.folderMillis));
      logger?.info(`Applied migration ${migration.hash}`);
    });
}
