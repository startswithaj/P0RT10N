import { desc, eq } from "drizzle-orm";
import type {
  ActivityView,
  FriendDetail,
  FriendListItem,
  UsageView,
} from "@p0rt1on/shared/domain";
import type { Db } from "./Database.ts";
import { activity, friends, instances, usage } from "./Schema.ts";
import { sumLast24h } from "../audit/requestBuckets.ts";

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

  /** Dashboard rows: friend + rolling activity + latest usage. */
  // deno-lint-ignore require-await
  async list(): Promise<FriendListItem[]> {
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
  // deno-lint-ignore require-await
  async usageHistory(friendId: number, limit: number): Promise<UsageView[]> {
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
  // deno-lint-ignore require-await
  async activityFor(friendId: number): Promise<ActivityView> {
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
  // deno-lint-ignore require-await
  async instancesForStatus(): Promise<
    Array<{
      kind: string;
      tsHostname: string;
      minioPort: number;
      status: string;
      tsTag: string;
    }>
  > {
    return this.db.select({
      kind: instances.kind,
      tsHostname: instances.tsHostname,
      minioPort: instances.minioPort,
      status: instances.status,
      tsTag: instances.tsTag,
    }).from(instances).all();
  }

  /** Map of friendId → newest usage sample (one pass, ascending then overwrite). */
  private latestUsageByFriend(): Map<number, UsageSample> {
    const rows = this.db.select({
      friendId: usage.friendId,
      bytesUsed: usage.bytesUsed,
      objectCount: usage.objectCount,
      checkedAt: usage.checkedAt,
    }).from(usage).orderBy(usage.checkedAt).all();
    // Ascending order means the last write for each key wins (= newest).
    return new Map(
      rows.map((r) => [r.friendId, {
        bytesUsed: r.bytesUsed,
        objectCount: r.objectCount,
        checkedAt: r.checkedAt,
      }]),
    );
  }
}

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
