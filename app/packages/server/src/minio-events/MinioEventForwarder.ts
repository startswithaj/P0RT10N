import type { Logger } from "../services/types.ts";
import type { MinioEventSubscription } from "./MinioEventSubscription.ts";

// Forwards every raw MinIO event to the operator's webhook, byte-compatible
// with MinIO: one event per POST, `application/json`, auth header verbatim.
// Best-effort — bounded retry then log, never blocks the bus. Mirrors MinIO's
// webhook client defaults (max_retry=5, retry_interval=1s, http_timeout=5s).

const DEFAULTS = { maxRetry: 5, retryIntervalMs: 1000, timeoutMs: 5000 };

/** Rate-limit forward-failure warnings: log the 1st failure, then every Nth. */
const FAIL_LOG_EVERY = 100;

export interface ForwardOptions {
  url: string;
  authorization?: string;
  maxRetry?: number;
  retryIntervalMs?: number;
  timeoutMs?: number;
}

export class MinioEventForwarder {
  private readonly url: string;
  private readonly authorization?: string;
  private readonly maxRetry: number;
  private readonly retryIntervalMs: number;
  private readonly timeoutMs: number;
  private failures = 0;
  /** Resolves when the event stream ends (shutdown). Forwarding starts on
   * construction; await this in tests / for a clean stop. */
  readonly done: Promise<void>;

  constructor(
    private readonly events: MinioEventSubscription<unknown>,
    opts: ForwardOptions,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.url = opts.url;
    this.authorization = opts.authorization;
    this.maxRetry = opts.maxRetry ?? DEFAULTS.maxRetry;
    this.retryIntervalMs = opts.retryIntervalMs ?? DEFAULTS.retryIntervalMs;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    this.done = this.run();
  }

  /** Forward each raw event until the subscription's signal aborts. Delivery
   * errors are caught in deliver(); this guard only covers an unexpected stream
   * failure so it never becomes an unhandled rejection. */
  private async run(): Promise<void> {
    try {
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      for await (const raw of this.events.events) {
        await this.deliver(raw, this.events.signal);
      }
    } catch (err) {
      this.logger.error("minio event forwarder stopped", {
        error: String(err),
      });
    }
  }

  /** POST one event, retrying up to maxRetry; log (rate-limited) on give-up. */
  private async deliver(raw: unknown, signal: AbortSignal): Promise<void> {
    const body = JSON.stringify(raw);
    // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
    for (let attempt = 1; attempt <= this.maxRetry; attempt++) {
      if (signal.aborted) return;
      try {
        const res = await this.fetchImpl(this.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.authorization
              ? { authorization: this.authorization }
              : {}),
          },
          body,
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(this.timeoutMs),
          ]),
        });
        await res.body?.cancel(); // release the connection; body is unused
        if (res.ok) return;
        if (attempt === this.maxRetry) {
          return this.noteFailure(`HTTP ${res.status}`);
        }
      } catch (err) {
        if (signal.aborted) return; // shutdown, not a delivery failure
        if (attempt === this.maxRetry) return this.noteFailure(String(err));
      }
      await this.backoff(signal);
    }
  }

  private noteFailure(error: string): void {
    this.failures++;
    if (this.failures === 1 || this.failures % FAIL_LOG_EVERY === 0) {
      this.logger.warn("minio event forward failed", {
        url: this.url,
        failures: this.failures,
        error,
      });
    }
  }

  private backoff(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, this.retryIntervalMs);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
  }
}
