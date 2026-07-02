/**
 * Compatibility wrapper adapting @db/sqlite's API to the surface
 * drizzle-orm/better-sqlite3 expects. better-sqlite3 wants
 * stmt.all()/get()/run()/raw().all(); @db/sqlite gives all()/get()/run()/values().
 * We bridge .raw() → .values(). (Ported from chargeHA's SqliteCompat.)
 */
import {
  Database as NativeDatabase,
  type RestBindParameters,
  type Statement,
} from "@db/sqlite";
import type {
  DatabaseDriver,
  DatabaseRawStatement,
  DatabaseStatement,
} from "./driver.ts";

/**
 * The DB opens with `int64: true` so integers > 2^31 aren't truncated to a
 * 32-bit value (a @db/sqlite v0.12 limitation — byte counts/quotas exceed that).
 * The driver then returns those as BigInt; we coerce back to JS number (safe up
 * to 2^53 ≈ 9 PB), since the rest of the app works in numbers.
 */
function fromBigInt(value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

function coerceRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, fromBigInt(v)]),
  );
}

class CompatStatement implements DatabaseStatement {
  constructor(private readonly stmt: Statement) {}

  all(...params: RestBindParameters): Record<string, unknown>[] {
    return this.stmt.all(...params).map(coerceRow);
  }

  get(...params: RestBindParameters): Record<string, unknown> | undefined {
    const row = this.stmt.get(...params) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : coerceRow(row);
  }

  run(
    ...params: RestBindParameters
  ): { changes: number; lastInsertRowid: number } {
    const changes = this.stmt.run(...params);
    return {
      changes: Number(changes),
      lastInsertRowid: Number(this.stmt.db.lastInsertRowId),
    };
  }

  /** "Raw mode" view returning tuples instead of objects. */
  raw(): DatabaseRawStatement {
    return new CompatRawStatement(this.stmt);
  }
}

class CompatRawStatement implements DatabaseRawStatement {
  constructor(private readonly stmt: Statement) {}

  all(...params: RestBindParameters): unknown[][] {
    return this.stmt.values(...params).map((tuple) => tuple.map(fromBigInt));
  }

  get(...params: RestBindParameters): unknown[] | undefined {
    const rows = this.stmt.values(...params);
    return rows.length > 0 ? rows[0].map(fromBigInt) : undefined;
  }
}

/** Wraps @db/sqlite with the better-sqlite3 API surface drizzle requires. */
export class CompatDatabase implements DatabaseDriver {
  private readonly native: NativeDatabase;

  constructor(path: string) {
    this.native = new NativeDatabase(path, { int64: true });
  }

  prepare(sql: string): DatabaseStatement {
    return new CompatStatement(this.native.prepare(sql));
  }

  exec(sql: string): void {
    this.native.exec(sql);
  }

  close(): void {
    this.native.close();
  }

  /**
   * better-sqlite3's transaction() returns deferred/immediate/exclusive
   * variants; drizzle calls `nativeTx[behavior](tx)` (default "deferred").
   */
  transaction<T, R>(
    fn: (tx: T) => R,
  ): {
    deferred: (tx: T) => R;
    immediate: (tx: T) => R;
    exclusive: (tx: T) => R;
  } {
    const db = this.native;
    const wrap = (begin: string) => (tx: T): R => {
      db.exec(begin);
      try {
        const result = fn(tx);
        db.exec("COMMIT");
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    };
    return {
      deferred: wrap("BEGIN DEFERRED"),
      immediate: wrap("BEGIN IMMEDIATE"),
      exclusive: wrap("BEGIN EXCLUSIVE"),
    };
  }
}
