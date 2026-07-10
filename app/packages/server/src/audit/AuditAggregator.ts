import { eq } from "drizzle-orm";
import { z } from "zod";
import type { RequestsByOp } from "@p0rt1on/shared/domain";
import type { Db } from "../db/Database.ts";
import { activity, friends } from "../db/Schema.ts";
import type { Logger } from "../services/types.ts";
import { bump, sumLast24h } from "./requestBuckets.ts";
import { defer } from "../lib/defer.ts";

// ============================================================================
// Receives MinIO audit-webhook events and folds them into the per-friend
// `activity` row (1:1, friendId PK). The friend is resolved by bucket name.
// Local-only, single-writer — a read-modify-write upsert is fine.
// ============================================================================

/** The fields we fold from a MinIO audit entry. */
export interface AuditEvent {
  bucket: string;
  op: string;
  statusCode: number;
  rx: number;
  tx: number;
  time: string;
  // Top-level access key of the caller; distinguishes friend traffic from the
  // manager's own root-key polling (mc du/admin).
  accessKey: string;
}

// MinIO audit entries nest the useful bits under `api`; parse defensively.
const auditSchema = z.object({
  time: z.string().optional(),
  accessKey: z.string().optional(),
  api: z.object({
    name: z.string().optional(),
    bucket: z.string().optional(),
    statusCode: z.number().optional(),
    rx: z.number().optional(),
    tx: z.number().optional(),
  }).optional(),
});

export class AuditAggregator {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly now: () => string = () => new Date().toISOString(),
    /**
     * Fired after each successfully-resolved event with the friend it
     * belonged to (the usage sampler's debounce trigger). Kept as a plain
     * callback until the audit event bus generalizes fan-out.
     */
    private readonly onActivity: (friendId: number) => void = () => {},
  ) {}

  /** Parse a raw webhook payload then ingest it; no-op on unparseable input. */
  ingestRaw(raw: unknown): Promise<void> {
    const event = this.parse(raw);
    if (!event) {
      this.logger.debug("skipping unparseable audit event");
      return Promise.resolve();
    }
    return this.ingest(event);
  }

  ingest(event: AuditEvent): Promise<void> {
    // Sync SQLite body deferred so a throw rejects (handleAudit Promise.alls
    // over events) rather than escaping synchronously.
    return defer(() => this.ingestSync(event));
  }

  private ingestSync(event: AuditEvent): void {
    const friend = this.db
      .select({ id: friends.id, s3AccessKeyId: friends.s3AccessKeyId })
      .from(friends).where(eq(friends.bucket, event.bucket)).get();
    if (!friend) {
      this.logger.debug("audit event for unknown bucket", {
        bucket: event.bucket,
      });
      return;
    }
    // The manager polls each instance with its root key (mc du/admin), which
    // MinIO audits back to us. Only the friend's bucket-scoped key is real
    // activity; skip everything else so idle friends don't accrue phantom
    // requests (and our own poll doesn't re-trigger the usage sampler below).
    if (event.accessKey !== friend.s3AccessKeyId) {
      this.logger.debug("skipping non-friend audit event", {
        bucket: event.bucket,
      });
      return;
    }
    const existing = this.db.select().from(activity)
      .where(eq(activity.friendId, friend.id)).get();
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

    this.onActivity(friend.id);
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
      }).where(eq(activity.friendId, friend.id)).run();
      return;
    }
    this.db.insert(activity).values({
      friendId: friend.id,
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

  private parse(raw: unknown): AuditEvent | null {
    const parsed = auditSchema.safeParse(raw);
    if (!parsed.success) return null;
    const api = parsed.data.api;
    if (!api?.bucket || !api.name) return null;
    return {
      bucket: api.bucket,
      op: api.name,
      statusCode: api.statusCode ?? 0,
      rx: api.rx ?? 0,
      tx: api.tx ?? 0,
      time: parsed.data.time ?? this.now(),
      accessKey: parsed.data.accessKey ?? "",
    };
  }
}
