import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import { CompatDatabase } from "./SqliteCompat.ts";
import type { DatabaseDriver } from "./driver.ts";

export type Db = BetterSQLite3Database;

export interface Database {
  db: Db;
  driver: DatabaseDriver;
}

export function openDatabase(path: string): Database {
  const driver = new CompatDatabase(path);
  const db = drizzle(driver as unknown as Parameters<typeof drizzle>[0]);
  return { db, driver };
}
