import { dirname } from "@std/path";
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

/**
 * Deno.uid() needs --allow-sys, which none of the manager's run configs grant.
 * Fall back to `id -u`, covered by the --allow-run permission they already
 * have; "unknown" if even that fails, since this is diagnostic-only and must
 * never itself throw or mask the real fatal error below.
 */
async function currentUid(): Promise<number | "unknown"> {
  try {
    return Deno.uid() ?? "unknown";
  } catch {
    try {
      const output = await new Deno.Command("id", { args: ["-u"] }).output();
      const stdout = new TextDecoder().decode(output.stdout).trim();
      return output.success && stdout ? Number(stdout) : "unknown";
    } catch {
      return "unknown";
    }
  }
}

/**
 * Probe-writes a temp file into the DB directory and removes it, so an
 * unwritable directory fails loudly at boot naming the path and uid instead
 * of surfacing later as an opaque `SqliteError: unable to open database file`.
 * Must run before openDatabase(); the caller treats this as fatal.
 */
export async function assertDbDirWritable(dbPath: string): Promise<void> {
  const dir = dirname(dbPath);

  try {
    await Deno.stat(dir);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      // Only resolve uid once we know we're building an error message —
      // the happy path (the common case, every successful boot) pays nothing for it.
      const uid = await currentUid();
      throw new Error(
        `p0rt1on database directory does not exist: ${dir} (running as uid ${uid}). ` +
          `Create the directory (and the volume backing it) before starting the manager.`,
      );
    }
    throw err;
  }

  const probePath = `${dir}/.p0rt1on-write-probe-${crypto.randomUUID()}`;
  try {
    await Deno.writeTextFile(probePath, "");
    await Deno.remove(probePath);
  } catch (err) {
    const uid = await currentUid();
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `p0rt1on database directory is not writable: ${dir} (running as uid ${uid}): ${detail}. ` +
        `If this is a Kubernetes hostPath volume, note that fsGroup does NOT apply to hostPath ` +
        `volumes — the host directory must be chowned to uid ${uid} (or made writable by it) directly.`,
    );
  }
}

export function openDatabase(path: string): Database {
  const driver = new CompatDatabase(path);
  const db = drizzle(driver as unknown as Parameters<typeof drizzle>[0]);
  return { db, driver };
}
