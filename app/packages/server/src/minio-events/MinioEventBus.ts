import type { Logger } from "../services/types.ts";
import { MinioEventSubscriber } from "./MinioEventSubscriber.ts";
import {
  type MinioEventSubscription,
  subscription,
} from "./MinioEventSubscription.ts";

// ============================================================================
// In-memory fan-out bus. One publisher (the webhook sink), N independent
// subscribers (aggregator, sampler, forwarder). Publish is synchronous and
// non-blocking: a slow/stalled subscriber can never back-pressure ingestion or
// starve the others (see MinioEventSubscriber). The bus carries the RAW MinIO
// payload untouched — the forwarder ships it through as-is; metrics consumers
// parse on read.
// ============================================================================

/** Per-subscriber queue depth; overflow drops the oldest event. */
const DEFAULT_CAPACITY = 1000;

export class MinioEventBus {
  private readonly subscribers = new Set<MinioEventSubscriber>();

  constructor(
    private readonly logger: Logger,
    // Shared shutdown signal: aborting it tears down every subscription.
    private readonly abort: AbortController,
    private readonly capacity: number = DEFAULT_CAPACITY,
  ) {}

  /** Fan one raw event to every subscriber. Never throws, never blocks. */
  publish(raw: unknown): void {
    // Isolate subscribers: a throw in one (e.g. a logger blowing up on an
    // overflow warning) must not abort fan-out to the others or bubble into
    // the publisher (the webhook sink).
    this.subscribers.forEach((sub) => {
      try {
        sub.enqueue(raw);
      } catch (err) {
        this.logger.error("minio event bus subscriber enqueue threw", {
          subscriber: sub.name,
          error: String(err),
        });
      }
    });
  }

  /**
   * Subscribe under `name`; the subscription yields raw events until the bus's
   * abort fires, when the queue is torn down (no leak across subscribe/abort
   * cycles). The signal is wired in here, so callers never pass one.
   */
  subscribe(name: string): MinioEventSubscription<unknown> {
    const sub = new MinioEventSubscriber(name, this.capacity, this.logger);
    this.subscribers.add(sub);

    const { signal } = this.abort;

    const remove = () => {
      this.subscribers.delete(sub);
      sub.close();
    };

    if (signal.aborted) remove();
    else signal.addEventListener("abort", remove, { once: true });
    return subscription(sub.stream(), signal);
  }

  /** Live subscriber count (tests/diagnostics). */
  get size(): number {
    return this.subscribers.size;
  }
}
