/// <reference lib="deno.ns" />
import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";
import type { DatabaseDriver } from "./driver.ts";
import type { Logger } from "../services/types.ts";

/** Path to the generated drizzle migrations folder at the repo root, resolved
 * from this module (NOT cwd) so boot works no matter where the server is
 * launched from. The Docker image copies `drizzle/` at the same relative spot. */
const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../../../../drizzle", import.meta.url),
);

/** Apply generated Drizzle migrations directly via @db/sqlite. Tracks applied
 * migrations by hash (not timestamp — @db/sqlite v0.12 truncates integers
 * > 2^31, re-populating the journal every boot). One source of truth for boot
 * and tests. */
export function runMigrations(sqlite: DatabaseDriver, logger?: Logger): void {
  applyMigrations(
    sqlite,
    readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }),
    logger,
  );
}

/** The subset of drizzle's migration metadata the runner applies. */
export interface MigrationEntry {
  hash: string;
  sql: string[];
  folderMillis: number;
}

/**
 * Each migration's statements AND its journal insert commit in one
 * transaction (BEGIN IMMEDIATE — take the write lock up front at boot), so a
 * crash or failing statement can never leave the schema half-applied with no
 * journal row. A failure aborts the run; later migrations are not attempted.
 * Exported separately from runMigrations so tests can apply synthetic
 * fixtures instead of the app's real migration files.
 */
export function applyMigrations(
  sqlite: DatabaseDriver,
  migrations: MigrationEntry[],
  logger?: Logger,
): void {
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

  // A throw inside forEach propagates, so a failed migration aborts the run
  // and later pending migrations are not attempted.
  migrations
    .filter((migration) => !applied.has(migration.hash))
    .forEach((migration) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        migration.sql.forEach((stmt, stmtIndex) => {
          try {
            sqlite.exec(stmt);
          } catch (e) {
            throw new Error(
              `statement ${stmtIndex}: ${
                e instanceof Error ? e.message : String(e)
              }`,
              { cause: e },
            );
          }
        });
        insert.run(migration.hash, String(migration.folderMillis));
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw new Error(
          `Migration ${migration.hash} failed at ${
            e instanceof Error ? e.message : String(e)
          }`,
          { cause: e },
        );
      }
      logger?.info(`Applied migration ${migration.hash}`);
    });
}
