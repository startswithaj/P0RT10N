import { eq } from "drizzle-orm";
import type { RequestsByOp } from "@p0rt1on/shared/domain";
import type { Db } from "../db/Database.ts";
import { activity } from "../db/Schema.ts";
import { bump, sumLast24h } from "./requestBuckets.ts";
import { defer } from "../lib/defer.ts";
import type { Logger } from "../services/types.ts";
import type { MinioEventSubscription } from "./MinioEventSubscription.ts";
import type { FriendEvent } from "./resolveFriend.ts";

// This is the only writer to the per-friend `activity` row, so the
// read-modify-write upsert below is safe without locking.

export class MinioEventAggregator {
  /** Resolves when the event stream ends. Folding starts on construction;
   * await this in tests or for a clean shutdown. */
  readonly done: Promise<void>;

  constructor(
    private readonly events: MinioEventSubscription<FriendEvent>,
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.done = this.run();
  }

  /** A mid-stream throw here is caught and logged rather than becoming an
   * unhandled rejection that would crash the process. */
  private async run(): Promise<void> {
    try {
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      for await (const fe of this.events.events) {
        await this.fold(fe);
      }
    } catch (err) {
      this.logger.error("minio event aggregator stopped", {
        error: String(err),
      });
    }
  }

  fold(fe: FriendEvent): Promise<void> {
    // The synchronous SQLite work is deferred so a throw becomes a promise
    // rejection instead of escaping synchronously.
    return defer(() => this.foldSync(fe));
  }

  private foldSync({ event, friendId }: FriendEvent): void {
    const existing = this.db.select().from(activity)
      .where(eq(activity.friendId, friendId)).get();
    const byOp: RequestsByOp = { ...existing?.requestsByOp };
    byOp[event.op] = (byOp[event.op] ?? 0) + 1;
    // A denied request is a failed auth: either 401 (bad or expired
    // credentials) or 403.
    const denied = event.statusCode === 401 || event.statusCode === 403 ? 1 : 0;
    const now = this.now();
    // requests24h is a synced cache of the in-window sum kept alongside the
    // raw buckets, even though reads could recompute it fresh.
    const requestBuckets = bump(
      existing?.requestBuckets ?? {},
      event.time,
      now,
    );

    if (existing) {
      this.db.update(activity).set({
        requestsTotal: existing.requestsTotal + 1,
        requests24h: sumLast24h(requestBuckets, now),
        requestBuckets,
        requestsByOp: byOp,
        // lastRequestAt is monotonic: an out-of-order event must never move
        // it backwards.
        lastRequestAt:
          existing.lastRequestAt && existing.lastRequestAt > event.time
            ? existing.lastRequestAt
            : event.time,
        lastOp: event.op,
        bytesInTotal: existing.bytesInTotal + event.rx,
        bytesOutTotal: existing.bytesOutTotal + event.tx,
        deniedCount: existing.deniedCount + denied,
        updatedAt: now,
      }).where(eq(activity.friendId, friendId)).run();
      return;
    }
    this.db.insert(activity).values({
      friendId,
      requestsTotal: 1,
      requests24h: sumLast24h(requestBuckets, now),
      requestBuckets,
      requestsByOp: byOp,
      lastRequestAt: event.time,
      lastOp: event.op,
      bytesInTotal: event.rx,
      bytesOutTotal: event.tx,
      deniedCount: denied,
      updatedAt: now,
    }).run();
  }
}
