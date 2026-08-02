/**
 * Adapts @db/sqlite's all()/get()/run()/values() surface to what
 * drizzle-orm/better-sqlite3 expects; .raw() bridges to .values().
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
 * int64: true keeps integers over 2^31 from truncating, a @db/sqlite v0.12
 * limitation that matters since byte counts/quotas exceed it; this coerces the result back to a JS number.
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

export class CompatDatabase implements DatabaseDriver {
  private readonly native: NativeDatabase;

  constructor(path: string) {
    this.native = new NativeDatabase(path, { int64: true });
    // WAL lets readers overlap a writer and busy_timeout avoids immediate SQLITE_BUSY
    // failures under lock contention, since the sweep and tRPC handlers share this DB.
    this.native.prepare("PRAGMA journal_mode = WAL").get();
    this.native.exec("PRAGMA busy_timeout = 5000");
    // SQLite defaults FK enforcement OFF per connection; Schema.ts declares FK
    // references that must actually be enforced at runtime.
    this.native.exec("PRAGMA foreign_keys = ON");
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
