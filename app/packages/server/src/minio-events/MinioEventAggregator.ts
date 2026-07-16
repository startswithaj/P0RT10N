import { eq } from "drizzle-orm";
import type { RequestsByOp } from "@p0rt1on/shared/domain";
import type { Db } from "../db/Database.ts";
import { activity } from "../db/Schema.ts";
import { bump, sumLast24h } from "./requestBuckets.ts";
import { defer } from "../lib/defer.ts";
import type { Logger } from "../services/types.ts";
import type { MinioEventSubscription } from "./MinioEventSubscription.ts";
import type { FriendEvent } from "./resolveFriend.ts";

// ============================================================================
// Folds resolved MinIO events into the per-friend `activity` row (1:1, friendId
// PK). Reads the friend-resolved stream — bucket→friend resolution and the
// anti-poll filter already happened upstream (resolveFriend, piped in at the
// call site). Local-only, single-writer, so a read-modify-write upsert is fine.
// ============================================================================

export class MinioEventAggregator {
  /** Resolves when the event stream ends (shutdown). The consumer starts
   * folding on construction; await this in tests / for a clean stop. */
  readonly done: Promise<void>;

  constructor(
    private readonly events: MinioEventSubscription<FriendEvent>,
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.done = this.run();
  }

  /** Fold resolved events into per-friend activity until the stream aborts. A
   * mid-stream throw (e.g. a SQLite error) stops this consumer, logged — it
   * never becomes an unhandled rejection that takes the process down. */
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

  /** Fold one resolved event into its friend's activity row. */
  fold(fe: FriendEvent): Promise<void> {
    // Sync SQLite body deferred so a throw rejects rather than escaping sync.
    return defer(() => this.foldSync(fe));
  }

  private foldSync({ event, friendId }: FriendEvent): void {
    const existing = this.db.select().from(activity)
      .where(eq(activity.friendId, friendId)).get();
    const byOp: RequestsByOp = { ...existing?.requestsByOp };
    byOp[event.op] = (byOp[event.op] ?? 0) + 1;
    // Denied = failed auth: 401 (bad/expired creds) as well as 403.
    const denied = event.statusCode === 401 || event.statusCode === 403 ? 1 : 0;
    const now = this.now();
    // Bucket this request by its own time, then keep requests24h as a synced
    // cache of the in-window sum (reads recompute, but this stays sensible too).
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
        // Monotonic: an out-of-order event must not move "last seen" backwards.
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
