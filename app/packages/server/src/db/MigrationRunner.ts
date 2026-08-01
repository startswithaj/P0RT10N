/// <reference lib="deno.ns" />
import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";
import type { DatabaseDriver } from "./driver.ts";
import type { Logger } from "../services/types.ts";

// Resolved from this module, not cwd, so boot works no matter where the server
// is launched from; the Docker image copies drizzle/ at this same relative spot.
const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../../../../drizzle", import.meta.url),
);

// Applied migrations are tracked by hash, not timestamp, because @db/sqlite v0.12
// truncates integers over 2^31 and would otherwise re-populate the journal every boot.
export function runMigrations(sqlite: DatabaseDriver, logger?: Logger): void {
  applyMigrations(
    sqlite,
    readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }),
    logger,
  );
}

export interface MigrationEntry {
  hash: string;
  sql: string[];
  folderMillis: number;
}

/**
 * Each migration's statements and its journal-insert commit run in one BEGIN
 * IMMEDIATE transaction, so a crash can never leave the schema half-applied.
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
