import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import { CompatDatabase } from "./SqliteCompat.ts";
import type { DatabaseDriver } from "./driver.ts";

// ============================================================================
// Drizzle handle over @db/sqlite (via the better-sqlite3-compatible adapter).
// `Db` is the typed query interface repositories use; `driver` is the low-level
// handle for migrations / DDL bootstrap. Migrations run at boot (separate,
// permissioned step); tests bootstrap the schema directly.
// ============================================================================

export type Db = BetterSQLite3Database;

export interface Database {
  db: Db;
  driver: DatabaseDriver;
}

/** Open a database at `path` (":memory:" for tests) and return drizzle + driver. */
export function openDatabase(path: string): Database {
  const driver = new CompatDatabase(path);
  const db = drizzle(driver as unknown as Parameters<typeof drizzle>[0]);
  return { db, driver };
}
