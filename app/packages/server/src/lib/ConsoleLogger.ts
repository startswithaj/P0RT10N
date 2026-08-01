import type { Logger, LogLevel } from "../services/types.ts";

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogSink = (level: LogLevel, line: string) => void;

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  sink?: LogSink;
  now?: () => string;
}

const CONSOLE_FN: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.debug(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

const defaultSink: LogSink = (level, line) => CONSOLE_FN[level](line);

export class ConsoleLogger implements Logger {
  readonly #level: LogLevel;
  readonly #threshold: number;
  readonly #bindings: Record<string, unknown>;
  readonly #sink: LogSink;
  readonly #now: () => string;

  constructor(opts: ConsoleLoggerOptions = {}) {
    this.#level = opts.level ?? "info";
    this.#threshold = RANK[this.#level];
    this.#bindings = opts.bindings ?? {};
    this.#sink = opts.sink ?? defaultSink;
    this.#now = opts.now ?? (() => new Date().toISOString());
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.#emit("debug", message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.#emit("info", message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.#emit("warn", message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.#emit("error", message, meta);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger({
      level: this.#level,
      bindings: { ...this.#bindings, ...bindings },
      sink: this.#sink,
      now: this.#now,
    });
  }

  #emit(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    if (RANK[level] < this.#threshold) return;
    const record = { ...this.#bindings, ...meta };
    const metaStr = Object.keys(record).length
      ? ` ${JSON.stringify(record)}`
      : "";
    const tag = level.toUpperCase().padEnd(5);
    this.#sink(level, `${this.#now()} ${tag} ${message}${metaStr}`);
  }
}
