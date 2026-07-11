import type { Logger } from "../services/types.ts";

// ============================================================================
// One audit-bus subscription: a bounded ring buffer feeding a parked-until-
// pushed async generator. Overflow drops the OLDEST event so a slow/stalled
// consumer never back-pressures the publisher — it only loses its own tail.
// ============================================================================

/** Rate-limit overflow warnings: log the 1st drop, then every Nth. */
const DROP_LOG_EVERY = 1000;

export class AuditSubscriber {
  private readonly items: unknown[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  drops = 0;

  constructor(
    readonly name: string,
    private readonly capacity: number,
    private readonly logger: Logger,
  ) {}

  enqueue(raw: unknown): void {
    if (this.closed) return;
    if (this.items.length >= this.capacity) {
      this.items.shift(); // drop oldest — a slow consumer never blocks ingest
      this.drops++;
      if (this.drops === 1 || this.drops % DROP_LOG_EVERY === 0) {
        this.logger.warn("audit bus subscriber overflow — dropping oldest", {
          subscriber: this.name,
          drops: this.drops,
        });
      }
    }
    this.items.push(raw);
    this.signal();
  }

  close(): void {
    this.closed = true;
    this.signal();
  }

  private signal(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  // Producer generator: yield each buffered event; hasNext() parks when the
  // queue is empty and returns false once closed-and-drained. The subscription
  // IS a live, unbounded stream — no collection to map over (same sanctioned
  // case as JobService's consumer).
  async *stream(): AsyncGenerator<unknown> {
    // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
    while (await this.hasNext()) {
      yield this.items.shift();
    }
  }

  /** Resolve true when an event is ready, false when closed and drained. */
  private hasNext(): Promise<boolean> {
    if (this.items.length > 0) return Promise.resolve(true);
    if (this.closed) return Promise.resolve(false);
    // Park until the next enqueue/close wakes us, then re-check.
    return new Promise<void>((resolve) => (this.wake = resolve))
      .then(() => this.hasNext());
  }
}
