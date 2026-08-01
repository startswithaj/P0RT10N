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
