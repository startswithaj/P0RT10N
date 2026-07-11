import type { Logger } from "../services/types.ts";
import { AuditSubscriber } from "./AuditSubscriber.ts";

// ============================================================================
// In-memory audit-event fan-out. One publisher (the webhook handler), N
// independent subscribers (aggregator, live stream, forwarder). Publish is
// synchronous and non-blocking: a slow/stalled subscriber can never
// back-pressure ingestion or starve the others (see AuditSubscriber).
//
// The bus carries the RAW MinIO payload, untouched. The forwarder ships it
// through exactly as received; the aggregator + live stream parse it
// themselves when they read it.
// ============================================================================

/** Per-subscriber queue depth; overflow drops the oldest event. */
const DEFAULT_CAPACITY = 1000;

export class AuditBus {
  private readonly subscribers = new Set<AuditSubscriber>();

  constructor(
    private readonly logger: Logger,
    private readonly capacity: number = DEFAULT_CAPACITY,
  ) {}

  /** Fan one raw event to every subscriber. Never throws, never blocks. */
  publish(raw: unknown): void {
    // Isolate subscribers: a throw in one (e.g. a logger blowing up on an
    // overflow warning) must not abort fan-out to the others or bubble into
    // the webhook handler.
    this.subscribers.forEach((sub) => {
      try {
        sub.enqueue(raw);
      } catch (err) {
        this.logger.error("audit bus subscriber enqueue threw", {
          subscriber: sub.name,
          error: String(err),
        });
      }
    });
  }

  /**
   * Subscribe under `name`; the returned iterable yields raw events until
   * `signal` aborts, when the queue is torn down (no leak across
   * subscribe/abort cycles).
   */
  subscribe(name: string, signal: AbortSignal): AsyncIterable<unknown> {
    const sub = new AuditSubscriber(name, this.capacity, this.logger);
    this.subscribers.add(sub);

    const remove = () => {
      this.subscribers.delete(sub);
      sub.close();
    };

    if (signal.aborted) remove();
    else signal.addEventListener("abort", remove, { once: true });
    return sub.stream();
  }

  /** Live subscriber count (tests/diagnostics). */
  get size(): number {
    return this.subscribers.size;
  }
}
