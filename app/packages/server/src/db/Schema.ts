import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import {
  AUDIT_ACTION_VALUES,
  ENROLLMENT_MODE_VALUES,
  FRIEND_STATUS_VALUES,
  INSTANCE_KIND_VALUES,
  INSTANCE_STATUS_VALUES,
  ISOLATION_MODE_VALUES,
  LOCK_MODE_VALUES,
  type RequestsByOp,
} from "@p0rt1on/shared/domain";
import type { RequestBuckets } from "../minio-events/requestBuckets.ts";

// This metadata DB stores no secrets, only which instances/buckets exist, their
// config, and aggregated activity/usage; never an S3 secret, Tailscale auth key, or encryption key.

export const instances = sqliteTable("instances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: INSTANCE_KIND_VALUES }).notNull(),
  minioPort: integer("minio_port").notNull(),
  tsHostname: text("ts_hostname").notNull(),
  tsTag: text("ts_tag").notNull(),
  // Offboard deletes by this stable tailnet node ID, not hostname, since the
  // control plane renames the hostname on collision. Null for pre-column instances.
  serveNodeId: text("serve_node_id"),
  status: text("status", { enum: INSTANCE_STATUS_VALUES })
    .notNull()
    .default("provisioning"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("uq_instances_minio_port").on(table.minioPort),
  index("idx_instances_kind_status").on(table.kind, table.status),
]);

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
  // Only the access key ID is stored here, never the secret. It's null between
  // row-reserve (step 1) and user creation (step 4) of the provisioning flow.
  s3AccessKeyId: text("s3_access_key_id"),
  tsNodeTag: text("ts_node_tag").notNull(),
  // Only the auth-key ID is stored, never the secret, so the key can still be
  // revoked on failure-reap, re-issue, or offboard while keeping zero-knowledge.
  tsKeyId: text("ts_key_id"),
  // Defaults to authKey so pre-column rows read as the existing tagged-node flow.
  enrollmentMode: text("enrollment_mode", { enum: ENROLLMENT_MODE_VALUES })
    .notNull()
    .default("authKey"),
  // These three fields are invite-flow only (null for authKey friends): inviteEmail
  // doubles as the ACL grant's login identity, and inviteStatus tracks pending/accepted/expired/manual.
  inviteEmail: text("invite_email"),
  inviteId: text("invite_id"),
  inviteStatus: text("invite_status"),
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

// Only metadata (counts, bytes, timestamps) is stored here, never object
// contents, preserving zero-knowledge.
export const activity = sqliteTable("activity", {
  friendId: integer("friend_id")
    .primaryKey()
    .references(() => friends.id),
  requestsTotal: integer("requests_total").notNull().default(0),
  // This column is JSON-mapped (op name to count) but stays `text` so SQLite JSON
  // operators still apply; mode: "json" handles parsing and serializing automatically.
  requestsByOp: text("requests_by_op", { mode: "json" }).$type<RequestsByOp>()
    .notNull().default(sql`'{}'`),
  // This is a denormalized cache of the requestBuckets below, kept in sync on each
  // event; reads recompute from requestBuckets so the count decays as a friend goes idle.
  requests24h: integer("requests_24h").notNull().default(0),
  // Hourly request tallies for the rolling 24h window, pruned to that window on every ingest.
  requestBuckets: text("request_buckets", { mode: "json" })
    .$type<RequestBuckets>().notNull().default(sql`'{}'`),
  lastRequestAt: text("last_request_at"),
  lastOp: text("last_op"),
  bytesInTotal: integer("bytes_in_total").notNull().default(0),
  bytesOutTotal: integer("bytes_out_total").notNull().default(0),
  // Denied/failed-auth count that drives the security nudge.
  deniedCount: integer("denied_count").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// These are point-in-time `mc du` samples, append-only; the latest row per
// friend is treated as current usage.
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

// friendId is nullable for non-friend-scoped system actions. friendName is a
// snapshot taken at write time so history survives the friend being offboarded or renamed.
export const audit = sqliteTable("audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  friendId: integer("friend_id").references(() => friends.id),
  friendName: text("friend_name"),
  action: text("action", { enum: AUDIT_ACTION_VALUES }).notNull(),
  detail: text("detail"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_audit_friend_created").on(table.friendId, table.createdAt),
  index("idx_audit_created").on(table.createdAt),
]);

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
