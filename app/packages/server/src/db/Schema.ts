import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import {
  FRIEND_STATUS_VALUES,
  INSTANCE_KIND_VALUES,
  INSTANCE_STATUS_VALUES,
  ISOLATION_MODE_VALUES,
  LOCK_MODE_VALUES,
  type RequestsByOp,
} from "@p0rt1on/shared/domain";
import type { RequestBuckets } from "../audit/requestBuckets.ts";

// ============================================================================
// p0rt1on metadata DB (SQLite via Drizzle) — NO SECRETS.
// Stores only: which instances/buckets exist, their config, and aggregated
// activity/usage. Never an S3 secret, Tailscale auth key, or encryption key.
// Migrations run as part of the boot sequence (chargeHA pattern).
// ============================================================================

// ---- Instances ----
// One row per running MinIO + tailscaled pair (the unit the runtime layer
// starts/stops). A `dedicated` instance backs exactly one friend; the single
// `shared` instance backs many. Holds the port + endpoint so shared-mode
// friends reference one row instead of duplicating it.
export const instances = sqliteTable("instances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: INSTANCE_KIND_VALUES }).notNull(),
  // Host port the MinIO container is published on; allocated for dedicated,
  // reused for the shared pool. Unique across non-failed instances.
  minioPort: integer("minio_port").notNull(),
  tsHostname: text("ts_hostname").notNull(),
  // The serve node's tag on our tailnet (instance side).
  tsTag: text("ts_tag").notNull(),
  status: text("status", { enum: INSTANCE_STATUS_VALUES })
    .notNull()
    .default("provisioning"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("uq_instances_minio_port").on(table.minioPort),
  index("idx_instances_kind_status").on(table.kind, table.status),
]);

// ---- Friends ----
// One row per friend. Endpoint/port live on `instances`; for `dedicated` it's a
// 1:1 reference, for `shared` many friends point at the same instance row.
// s3AccessKeyId is the access key **ID only** — the secret is never stored.
export const friends = sqliteTable("friends", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  isolationMode: text("isolation_mode", { enum: ISOLATION_MODE_VALUES })
    .notNull(),
  instanceId: integer("instance_id")
    .notNull()
    .references(() => instances.id),
  bucket: text("bucket").notNull(),
  quotaBytes: integer("quota_bytes").notNull(),
  lockMode: text("lock_mode", { enum: LOCK_MODE_VALUES })
    .notNull()
    .default("GOVERNANCE"),
  lockRetentionDays: integer("lock_retention_days").notNull(),
  // Access key ID only — never the secret. Null between row-reserve (step 1)
  // and user creation (step 4) of the provisioning flow.
  s3AccessKeyId: text("s3_access_key_id"),
  // The friend's client node tag (`tag:p0rt1on-friend-<name>`), gated by ACL.
  tsNodeTag: text("ts_node_tag").notNull(),
  // Tailscale auth-key ID only — never the key secret (zero-knowledge). Kept
  // so the key can be revoked on failure-reap, re-issue, and offboard. Null
  // for friends provisioned before this column (their keys expire naturally).
  tsKeyId: text("ts_key_id"),
  status: text("status", { enum: FRIEND_STATUS_VALUES })
    .notNull()
    .default("provisioning"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("uq_friends_name").on(table.name),
  // Bucket names are unique within an instance (shared pool buckets coexist).
  uniqueIndex("uq_friends_instance_bucket").on(table.instanceId, table.bucket),
  index("idx_friends_instance").on(table.instanceId),
  index("idx_friends_status").on(table.status),
]);

// ---- Activity ----
// One row per friend, upserted by the audit-webhook aggregator. Metadata only
// (counts, bytes, timestamps) — never object contents (zero-knowledge holds).
export const activity = sqliteTable("activity", {
  // 1:1 with friends; friendId is the PK.
  friendId: integer("friend_id")
    .primaryKey()
    .references(() => friends.id),
  requestsTotal: integer("requests_total").notNull().default(0),
  // JSON object of raw MinIO op name -> count. `mode: "json"` makes drizzle parse/serialize
  // automatically (reads return the object, not the raw text); the column is
  // still `text`, so SQLite's JSON operators (-> / ->> / json_each) still apply
  // and no migration changes. Raw SQL default for the text literal '{}'.
  requestsByOp: text("requests_by_op", { mode: "json" }).$type<RequestsByOp>()
    .notNull().default(sql`'{}'`),
  // Rolling request count over the last 24h. Denormalized cache of the buckets
  // below (kept in sync on each event); reads recompute from `requestBuckets`
  // so the count decays as a friend goes idle rather than freezing.
  requests24h: integer("requests_24h").notNull().default(0),
  // Hourly request tallies (hour-epoch -> count) for the rolling-24h window.
  // JSON map, pruned to the window on every ingest. See audit/requestBuckets.ts.
  requestBuckets: text("request_buckets", { mode: "json" })
    .$type<RequestBuckets>().notNull().default(sql`'{}'`),
  lastRequestAt: text("last_request_at"),
  lastOp: text("last_op"),
  bytesInTotal: integer("bytes_in_total").notNull().default(0),
  bytesOutTotal: integer("bytes_out_total").notNull().default(0),
  // Denied / failed-auth count — drives the security nudge.
  deniedCount: integer("denied_count").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ---- Usage ----
// Point-in-time `mc du` samples (append-only); the latest row is "current usage".
export const usage = sqliteTable("usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  friendId: integer("friend_id")
    .notNull()
    .references(() => friends.id),
  bytesUsed: integer("bytes_used").notNull(),
  objectCount: integer("object_count").notNull(),
  checkedAt: text("checked_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_usage_friend_checked").on(table.friendId, table.checkedAt),
]);

// ---- Audit ----
// Admin actions taken in the UI (add/resize/rotate/suspend/offboard). friendId
// is nullable for non-friend-scoped actions. `detail` is optional JSON context.
export const audit = sqliteTable("audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  friendId: integer("friend_id").references(() => friends.id),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_audit_friend_created").on(table.friendId, table.createdAt),
  index("idx_audit_created").on(table.createdAt),
]);

// ---- Inferred row / insert types ----

export type Instance = typeof instances.$inferSelect;
export type NewInstance = typeof instances.$inferInsert;

export type Friend = typeof friends.$inferSelect;
export type NewFriend = typeof friends.$inferInsert;

export type Activity = typeof activity.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;

export type Usage = typeof usage.$inferSelect;
export type NewUsage = typeof usage.$inferInsert;

export type AuditEntry = typeof audit.$inferSelect;
export type NewAuditEntry = typeof audit.$inferInsert;
