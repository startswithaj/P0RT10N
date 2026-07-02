// ============================================================================
// Database driver interface — the contract between drizzle and the underlying
// SQLite. Implemented by SqliteCompat.ts over @db/sqlite (native FFI). Ported
// from chargeHA, trimmed to what p0rt1on uses (no browser/WASM target).
// ============================================================================

export type BindValue =
  | number
  | string
  | bigint
  | boolean
  | null
  | undefined
  | Uint8Array;

export interface DatabaseStatement {
  all(...params: BindValue[]): Record<string, unknown>[];
  get(...params: BindValue[]): Record<string, unknown> | undefined;
  run(...params: BindValue[]): { changes: number; lastInsertRowid: number };
  raw(): DatabaseRawStatement;
}

export interface DatabaseRawStatement {
  all(...params: BindValue[]): unknown[][];
  get(...params: BindValue[]): unknown[] | undefined;
}

export interface DatabaseDriver {
  prepare(sql: string): DatabaseStatement;
  exec(sql: string): void;
  close(): void;
  transaction<T, R>(
    fn: (tx: T) => R,
  ): {
    deferred: (tx: T) => R;
    immediate: (tx: T) => R;
    exclusive: (tx: T) => R;
  };
}
