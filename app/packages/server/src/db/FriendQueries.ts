import { and, desc, eq, lt, max } from "drizzle-orm";
import type {
  ActivityView,
  AuditEntryView,
  FriendDetail,
  FriendListItem,
  UsageView,
} from "@p0rt1on/shared/domain";
import type { Db } from "./Database.ts";
import { activity, audit, friends, instances, usage } from "./Schema.ts";
import type { RequestBuckets } from "../minio-events/requestBuckets.ts";
import { hourlySeries, sumLast24h } from "../minio-events/requestBuckets.ts";
import { defer } from "../lib/defer.ts";

/**
 * The DB-derived part of a FriendDetail. The service fills the two fields this
 * layer can't: `nodeOnline` (Tailscale) and `s3Endpoint` (needs the configured
 * tailnet domain, built from `tsHostname`).
 */
export type FriendDetailRow =
  & Omit<FriendDetail, "nodeOnline" | "s3Endpoint">
  & { tsHostname: string };

// ============================================================================
// Read-side queries for the dashboard + usage screens. Pure DB — no external
// deps. The friend-detail screen also needs Tailscale's node-online state, so
// it's assembled a layer up (FriendService), not here.
// ============================================================================

/** One friend the usage sampler should measure. */
export interface UsageSampleTarget {
  friendId: number;
  bucket: string;
  alias: string;
  /** Host-published admin-plane port (composes the per-call MC_HOST endpoint). */
  minioPort: number;
}

/** Latest usage sample for a friend (or zeros if none recorded yet). */
interface UsageSample {
  bytesUsed: number;
  objectCount: number;
  checkedAt: string | null;
}

export class FriendQueries {
  constructor(
    private readonly db: Db,
    // Injected clock so the rolling-24h window is deterministic in tests.
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Resolve a bucket to its friend's id + bucket-scoped access key (or none).
   * Synchronous — the MinIO-event stream stages resolve per event. */
  friendByBucket(
    bucket: string,
  ): { id: number; s3AccessKeyId: string | null } | undefined {
    return this.db
      .select({ id: friends.id, s3AccessKeyId: friends.s3AccessKeyId })
      .from(friends).where(eq(friends.bucket, bucket)).get();
  }

  // Synchronous SQLite reads exposed as Promises (service contract); each
  // body runs via defer() so a throw rejects rather than escaping
  // synchronously — same semantics `async` gave, without the unused-await.

  /** Dashboard rows: friend + rolling activity + latest usage. */
  list(): Promise<FriendListItem[]> {
    return defer(() => this.listSync());
  }

  private listSync(): FriendListItem[] {
    const rows = this.db.select({
      id: friends.id,
      name: friends.name,
      isolationMode: friends.isolationMode,
      status: friends.status,
      lockMode: friends.lockMode,
      lockRetentionDays: friends.lockRetentionDays,
      quotaBytes: friends.quotaBytes,
      requestBuckets: activity.requestBuckets,
      lastRequestAt: activity.lastRequestAt,
    }).from(friends)
      .leftJoin(activity, eq(activity.friendId, friends.id))
      // Stable creation order (id breaks same-timestamp ties).
      .orderBy(friends.createdAt, friends.id)
      .all();

    const latest = this.latestUsageByFriend();
    const now = this.now();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isolationMode: r.isolationMode,
      status: r.status,
      lockMode: r.lockMode,
      lockRetentionDays: r.lockRetentionDays,
      usage: usageView(latest.get(r.id), r.quotaBytes),
      requests24h: sumLast24h(r.requestBuckets ?? {}, now),
      lastRequestAt: r.lastRequestAt ?? null,
    }));
  }

  /** Point-in-time usage samples for one friend, newest first. */
  usageHistory(friendId: number, limit: number): Promise<UsageView[]> {
    return defer(() => this.usageHistorySync(friendId, limit));
  }

  /** Audit log newest-first, page back via `before` (id cursor). `friend` is the
   * write-time snapshot name (survives offboard); null → a system event. */
  recentAuditEntries(
    limit: number,
    before?: number,
  ): Promise<AuditEntryView[]> {
    return defer(() =>
      this.db.select({
        id: audit.id,
        when: audit.createdAt,
        action: audit.action,
        friend: audit.friendName,
        detail: audit.detail,
      })
        .from(audit)
        .where(before ? lt(audit.id, before) : undefined)
        .orderBy(desc(audit.id))
        .limit(limit)
        .all()
    );
  }

  private usageHistorySync(friendId: number, limit: number): UsageView[] {
    const quota = this.db.select({ quotaBytes: friends.quotaBytes })
      .from(friends).where(eq(friends.id, friendId)).get();
    if (!quota) return [];
    const rows = this.db.select({
      bytesUsed: usage.bytesUsed,
      objectCount: usage.objectCount,
      checkedAt: usage.checkedAt,
    }).from(usage)
      .where(eq(usage.friendId, friendId))
      .orderBy(desc(usage.checkedAt))
      .limit(limit)
      .all();
    return rows.map((r) => usageView(r, quota.quotaBytes));
  }

  /**
   * Friend-detail join (friend + instance + latest usage + activity). Returns
   * `null` for an unknown friend; the caller (FriendService.get) decides how to
   * surface that and fills `nodeOnline` + `s3Endpoint`.
   */
  async detail(friendId: number): Promise<FriendDetailRow | null> {
    const row = this.db.select({
      id: friends.id,
      name: friends.name,
      isolationMode: friends.isolationMode,
      status: friends.status,
      bucket: friends.bucket,
      s3AccessKeyId: friends.s3AccessKeyId,
      tsNodeTag: friends.tsNodeTag,
      lockMode: friends.lockMode,
      lockRetentionDays: friends.lockRetentionDays,
      quotaBytes: friends.quotaBytes,
      instanceKind: instances.kind,
      instanceStatus: instances.status,
      tsHostname: instances.tsHostname,
    }).from(friends)
      .innerJoin(instances, eq(friends.instanceId, instances.id))
      .where(eq(friends.id, friendId)).get();
    if (!row) return null;

    const latest = this.db.select({
      bytesUsed: usage.bytesUsed,
      objectCount: usage.objectCount,
      checkedAt: usage.checkedAt,
    }).from(usage)
      .where(eq(usage.friendId, friendId))
      .orderBy(desc(usage.checkedAt))
      .get();

    return {
      id: row.id,
      name: row.name,
      isolationMode: row.isolationMode,
      status: row.status,
      bucket: row.bucket,
      s3AccessKeyId: row.s3AccessKeyId,
      tsNodeTag: row.tsNodeTag,
      lockMode: row.lockMode,
      lockRetentionDays: row.lockRetentionDays,
      instanceKind: row.instanceKind,
      instanceStatus: row.instanceStatus,
      tsHostname: row.tsHostname,
      usage: usageView(latest ?? undefined, row.quotaBytes),
      activity: await this.activityFor(friendId),
    };
  }

  /** Current aggregated activity for one friend (zeros if none recorded yet). */
  activityFor(friendId: number): Promise<ActivityView> {
    return defer(() => this.activityForSync(friendId));
  }

  private activityForSync(friendId: number): ActivityView {
    const row = this.db.select().from(activity)
      .where(eq(activity.friendId, friendId)).get();
    if (!row) {
      return {
        requestsTotal: 0,
        requestsByOp: {},
        requests24h: 0,
        lastRequestAt: null,
        lastOp: null,
        bytesInTotal: 0,
        bytesOutTotal: 0,
        deniedCount: 0,
        updatedAt: "",
      };
    }
    return {
      requestsTotal: row.requestsTotal,
      requestsByOp: row.requestsByOp, // parsed via mode:"json"
      requests24h: sumLast24h(row.requestBuckets, this.now()),
      lastRequestAt: row.lastRequestAt,
      lastOp: row.lastOp,
      bytesInTotal: row.bytesInTotal,
      bytesOutTotal: row.bytesOutTotal,
      deniedCount: row.deniedCount,
      updatedAt: row.updatedAt,
    };
  }

  /** All instances, for the Status page inventory (kind/host/port + status). */
  instancesForStatus(): Promise<
    Array<{
      kind: string;
      tsHostname: string;
      minioPort: number;
      status: string;
      tsTag: string;
    }>
  > {
    return defer(() =>
      this.db.select({
        kind: instances.kind,
        tsHostname: instances.tsHostname,
        minioPort: instances.minioPort,
        status: instances.status,
        tsTag: instances.tsTag,
      }).from(instances).all()
    );
  }

  /** tsHostname → last-24h hourly request series (summed across the instance's
   * friends). Instances with no activity are absent from the map. */
  requestSeriesByInstance(): Promise<Map<string, number[]>> {
    return defer(() => {
      const now = this.now();
      const rows = this.db.select({
        tsHostname: instances.tsHostname,
        requestBuckets: activity.requestBuckets,
      }).from(instances)
        .innerJoin(friends, eq(friends.instanceId, instances.id))
        .innerJoin(activity, eq(activity.friendId, friends.id)).all();
      // Fold each instance's friends' hourly buckets into one summed map, then
      // materialize the fixed-length window series.
      const summed = rows.reduce((acc, r) => {
        const merged = Object.entries(r.requestBuckets).reduce(
          (m, [hour, count]) => ({ ...m, [hour]: (m[hour] ?? 0) + count }),
          acc.get(r.tsHostname) ?? {} as RequestBuckets,
        );
        return acc.set(r.tsHostname, merged);
      }, new Map<string, RequestBuckets>());
      return new Map(
        [...summed].map(([host, b]) => [host, hourlySeries(b, now)]),
      );
    });
  }

  /** Map of friendId → newest usage sample, computed in SQL (O(friends), not
   * O(history) — the usage table is append-only and grows unboundedly). */
  private latestUsageByFriend(): Map<number, UsageSample> {
    const latest = this.db.select({
      friendId: usage.friendId,
      checkedAt: max(usage.checkedAt).as("latest_checked_at"),
    }).from(usage).groupBy(usage.friendId).as("latest");
    const rows = this.db.select({
      friendId: usage.friendId,
      bytesUsed: usage.bytesUsed,
      objectCount: usage.objectCount,
      checkedAt: usage.checkedAt,
    }).from(usage).innerJoin(
      latest,
      and(
        eq(usage.friendId, latest.friendId),
        eq(usage.checkedAt, latest.checkedAt),
      ),
    ).all();
    return new Map(
      rows.map((r) => [r.friendId, {
        bytesUsed: r.bytesUsed,
        objectCount: r.objectCount,
        checkedAt: r.checkedAt,
      }]),
    );
  }

  /** Active friends with what the usage sampler needs to `mc du` them. */
  usageSampleTargets(): Promise<UsageSampleTarget[]> {
    return defer(() =>
      this.db.select({
        friendId: friends.id,
        bucket: friends.bucket,
        // The per-instance mc alias is its tailnet hostname (same convention
        // as BootReconciler.realign).
        alias: instances.tsHostname,
        minioPort: instances.minioPort,
      }).from(friends)
        .innerJoin(instances, eq(instances.id, friends.instanceId))
        .where(eq(friends.status, "active"))
        .all()
    );
  }

  /** Append one point-in-time usage sample (the write side of usageHistory). */
  insertUsage(
    friendId: number,
    sample: { bytesUsed: number; objectCount: number },
  ): Promise<void> {
    return defer(() => {
      this.db.insert(usage).values({
        friendId,
        bytesUsed: sample.bytesUsed,
        objectCount: sample.objectCount,
        checkedAt: this.now(),
      }).run();
    });
  }

  /** Delete usage samples older than the retention cutoff (bounded work: one
   * DELETE). Piggybacks on the periodic sweep. Returns rows deleted. */
  pruneUsage(): Promise<number> {
    return defer(() => {
      const cutoff = new Date(
        new Date(this.now()).getTime() - USAGE_RETENTION_DAYS * 24 * 3_600_000,
      ).toISOString();
      return this.db.delete(usage).where(lt(usage.checkedAt, cutoff)).run()
        .changes;
    });
  }
}

/** Days of usage-sample history kept for the history screen. */
export const USAGE_RETENTION_DAYS = 90;

/** Build a UsageView from a sample (or zeros) against the friend's quota. */
function usageView(
  sample: UsageSample | undefined,
  quotaBytes: number,
): UsageView {
  const bytesUsed = sample?.bytesUsed ?? 0;
  return {
    bytesUsed,
    objectCount: sample?.objectCount ?? 0,
    quotaBytes,
    fraction: quotaBytes > 0 ? Math.min(1, bytesUsed / quotaBytes) : 0,
    checkedAt: sample?.checkedAt ?? null,
  };
}
