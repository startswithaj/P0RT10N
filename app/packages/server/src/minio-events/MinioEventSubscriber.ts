import type { Logger } from "../services/types.ts";

// A bounded ring buffer: overflow drops the oldest event, so a slow consumer
// never back-pressures the publisher, only loses its own tail.

const DROP_LOG_EVERY = 1000;

export class MinioEventSubscriber {
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
      this.items.shift();
      this.drops++;
      if (this.drops === 1 || this.drops % DROP_LOG_EVERY === 0) {
        this.logger.warn(
          "minio event bus subscriber overflow — dropping oldest",
          {
            subscriber: this.name,
            drops: this.drops,
          },
        );
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

  async *stream(): AsyncGenerator<unknown> {
    // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
    while (await this.hasNext()) {
      yield this.items.shift();
    }
  }

  private hasNext(): Promise<boolean> {
    if (this.items.length > 0) return Promise.resolve(true);
    if (this.closed) return Promise.resolve(false);
    // Park until the next enqueue/close wakes us, then re-check.
    return new Promise<void>((resolve) => (this.wake = resolve))
      .then(() => this.hasNext());
  }
}
