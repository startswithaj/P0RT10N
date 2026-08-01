import type { Logger } from "../services/types.ts";
import { MinioEventSubscriber } from "./MinioEventSubscriber.ts";
import {
  type MinioEventSubscription,
  subscription,
} from "./MinioEventSubscription.ts";

// Publish is synchronous and non-blocking, so a stalled subscriber never
// back-pressures ingest. Events carry the raw payload untouched; each
// consumer parses it on read.

/** Each subscriber queue holds this many events; once full, the oldest event
 * is dropped to make room. */
const DEFAULT_CAPACITY = 1000;

export class MinioEventBus {
  private readonly subscribers = new Set<MinioEventSubscriber>();

  constructor(
    private readonly logger: Logger,
    // Aborting this shared signal tears down every subscription.
    private readonly abort: AbortController,
    private readonly capacity: number = DEFAULT_CAPACITY,
  ) {}

  /** Never throws and never blocks, even if a subscriber's enqueue fails. */
  publish(raw: unknown): void {
    // Each subscriber's enqueue is isolated: a throw here (e.g. a logging
    // failure) must not stop fan-out to the others or bubble into the publisher.
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

  /** Yields raw events until the bus's shared abort fires, then tears the
   * queue down so nothing leaks across subscribe/abort cycles. */
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

  get size(): number {
    return this.subscribers.size;
  }
}
