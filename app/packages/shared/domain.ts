import { z } from "zod";

// ============================================================================
// p0rt1on shared domain — enums, primitives, and tRPC input schemas.
// Single source of truth for both the Drizzle schema (server/src/db/Schema.ts,
// which reuses the *_VALUES tuples for its text() enum columns) and the API.
// ============================================================================

// ---- Enums (as const tuples so Drizzle + zod share one definition) ----

/**
 * Isolation topology, chosen per friend at "Add friend" time.
 * - dedicated: own MinIO + tailscaled + endpoint (VPN-layer isolation).
 * - shared: a bucket + scoped key on the single shared pool (IAM + tag isolation).
 */
export const ISOLATION_MODE_VALUES = ["dedicated", "shared"] as const;
export type IsolationMode = (typeof ISOLATION_MODE_VALUES)[number];
export const isolationModeSchema = z.enum(ISOLATION_MODE_VALUES);

/** An `instances` row mirrors the friend's isolation mode. */
export const INSTANCE_KIND_VALUES = ISOLATION_MODE_VALUES;
export type InstanceKind = IsolationMode;

/**
 * Friend lifecycle. provisioning → active is the happy path; a crash leaves the
 * row recoverable (failed) for the cleanup sweep. suspend/offboard are admin actions.
 */
export const FRIEND_STATUS_VALUES = [
  "provisioning",
  "active",
  "suspended",
  "offboarding",
  "failed",
] as const;
export type FriendStatus = (typeof FRIEND_STATUS_VALUES)[number];

/** Instance (container-pair) lifecycle, owned by the runtime layer. */
export const INSTANCE_STATUS_VALUES = [
  "provisioning",
  "active",
  "stopped",
  // Marked (atomically, while counting friends) before teardown begins, so a
  // concurrent add can never adopt an instance that is about to be removed.
  "reaping",
  "failed",
] as const;
export type InstanceStatus = (typeof INSTANCE_STATUS_VALUES)[number];

/**
 * Object Lock mode. GOVERNANCE (default) is bypassable by server root for
 * offboarding; COMPLIANCE is undeletable even by us (opt-in, blocks offboard).
 */
export const LOCK_MODE_VALUES = ["GOVERNANCE", "COMPLIANCE"] as const;
export type LockMode = (typeof LOCK_MODE_VALUES)[number];
export const lockModeSchema = z.enum(LOCK_MODE_VALUES);

// ---- Primitives ----

/** Friend display name: also the basis for bucket + tag, so keep it tame.
 * min(3) is MinIO's bucket-name minimum — the name IS the bucket name, and a
 * shorter one provisions a friend whose bucket can never be created.
 * max(50) leaves headroom in the 63-char DNS label for the `p0rt1on-`
 * container/volume name prefixes. */
const friendNameSchema: z.ZodString = z
  .string()
  .min(3, "at least 3 characters (it becomes the S3 bucket name)")
  .max(50, "at most 50 characters (it becomes part of DNS/container names)")
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "lowercase letters/digits/hyphens, starting with a letter or digit",
  );

/** A byte count. SQLite INTEGER is 64-bit, so raw bytes are safe. */
const byteCountSchema: z.ZodNumber = z.number().int().positive();

const retentionDaysSchema: z.ZodNumber = z.number().int().min(1).max(36500);

// ============================================================================
// tRPC input schemas (validated at the API boundary)
// ============================================================================

/** "Add friend" — drives the provisioning state machine. */
export const addFriendInput: z.ZodObject<{
  name: typeof friendNameSchema;
  quotaBytes: typeof byteCountSchema;
  retentionDays: typeof retentionDaysSchema;
  isolationMode: typeof isolationModeSchema;
  lockMode: z.ZodDefault<typeof lockModeSchema>;
}> = z.object({
  name: friendNameSchema,
  quotaBytes: byteCountSchema,
  retentionDays: retentionDaysSchema,
  isolationMode: isolationModeSchema,
  lockMode: lockModeSchema.default("GOVERNANCE"),
});
export type AddFriendInput = z.infer<typeof addFriendInput>;

const friendIdSchema: z.ZodNumber = z.number().int().positive();

/** Resize quota — effective immediately; shrinking below usage just rejects new PUTs. */
export const resizeFriendInput: z.ZodObject<{
  friendId: typeof friendIdSchema;
  quotaBytes: typeof byteCountSchema;
}> = z.object({ friendId: friendIdSchema, quotaBytes: byteCountSchema });
export type ResizeFriendInput = z.infer<typeof resizeFriendInput>;

/** Rotate key — also the lost-key recovery path; returns a once-shown secret. */
export const rotateKeyInput: z.ZodObject<{ friendId: typeof friendIdSchema }> =
  z
    .object({ friendId: friendIdSchema });
export type RotateKeyInput = z.infer<typeof rotateKeyInput>;

/** Re-issue the friend's Tailscale enrollment key (lost-key / re-enroll a node). */
export const reissueTsKeyInput: z.ZodObject<
  { friendId: typeof friendIdSchema }
> = z.object({ friendId: friendIdSchema });
export type ReissueTsKeyInput = z.infer<typeof reissueTsKeyInput>;

/** Suspend — disable the user + revoke the node (dedicated may also stop the pair). */
export const suspendFriendInput: z.ZodObject<
  { friendId: typeof friendIdSchema }
> = z.object({ friendId: friendIdSchema });
export type SuspendFriendInput = z.infer<typeof suspendFriendInput>;

/** Resume — re-enable the S3 user; the friend re-enrolls a node via a new key. */
export const resumeFriendInput: z.ZodObject<
  { friendId: typeof friendIdSchema }
> = z.object({ friendId: friendIdSchema });
export type ResumeFriendInput = z.infer<typeof resumeFriendInput>;

/** Offboard — destructive; mode-aware teardown. Name confirmation is UI-only. */
export const offboardFriendInput: z.ZodObject<{
  friendId: typeof friendIdSchema;
}> = z.object({ friendId: friendIdSchema });
export type OffboardFriendInput = z.infer<typeof offboardFriendInput>;

export const getFriendInput: z.ZodObject<{ friendId: typeof friendIdSchema }> =
  z
    .object({ friendId: friendIdSchema });
export type GetFriendInput = z.infer<typeof getFriendInput>;

/** Job observer inputs: `jobs.progress` (SSE replay+live) and the single-claim
 * bundle handover `jobs.claimBundle`. Job ids are opaque UUIDs. */
export const jobIdSchema: z.ZodString = z.string().uuid();
export const jobInput: z.ZodObject<{ jobId: typeof jobIdSchema }> = z.object({
  jobId: jobIdSchema,
});
export type JobInput = z.infer<typeof jobInput>;

/** Usage history (point-in-time `mc du` samples), newest first. */
export const usageHistoryInput: z.ZodObject<{
  friendId: typeof friendIdSchema;
  limit: z.ZodDefault<z.ZodNumber>;
}> = z.object({
  friendId: friendIdSchema,
  limit: z.number().int().min(1).max(500).default(100),
});
export type UsageHistoryInput = z.infer<typeof usageHistoryInput>;

// ============================================================================
// API output shapes that are NOT 1:1 with a table
// ============================================================================

/**
 * The friend bundle — assembled in memory, returned ONCE, never persisted.
 * The secrets (s3SecretKey, tsAuthKey) exist only in this response.
 *
 * The Tailscale fields are OPTIONAL: `addFriend` populates them (the node isn't
 * enrolled yet), but `rotateKey` omits them — rotation re-issues only the S3
 * secret; the friend's node is already enrolled, so minting a second auth key
 * would be pointless and a security smell.
 */
export type FriendBundle = {
  name: string;
  s3Endpoint: string;
  region: string;
  bucket: string;
  s3AccessKeyId: string;
  s3SecretKey: string; // shown once
  tsAuthKey?: string; // shown once; addFriend only
  tailscaleUpCommand?: string; // addFriend only
  /** Manual-ACL mode: grant lines the admin must paste into their policy. */
  manualAclInstructions?: string; // addFriend only, when aclMode="manual"
  kopiaQuickstart: string;
  /**
   * Non-fatal degradations the admin should know about (e.g. rotate could not
   * remove the old credential; it stays live until the next rotate/offboard).
   * The operation still succeeded — these must be surfaced, not hidden in logs.
   */
  warnings?: string[];
};

// Progress-step definitions live in ./steps (no zod dep, so the client can
// import the runtime values without bundling zod). Re-exported here for servers.
export {
  OFFBOARD_STEPS,
  type OffboardStepKey,
  type ProgressStep,
  PROVISION_STEPS,
  type ProvisionStepKey,
} from "./steps.ts";

/**
 * Offboard outcome. `manualAclCleanup` (manual ACL mode only) lists the policy
 * entries the admin should remove by hand — advisory: the offboard already
 * completed, and the manager can't edit the policy in that mode.
 */
export type OffboardResult = {
  manualAclCleanup?: string;
};

/** The re-issued Tailscale enrollment key hand-off (shown once). */
export type TsKeyBundle = {
  name: string;
  tsAuthKey: string;
  tailscaleUpCommand: string;
};

/** Request counts keyed by MinIO's raw API op name (bounded by MinIO's API
 * surface, ~130 names); serialized to JSON in the `activity.requestsByOp`
 * column. Any display-time grouping happens where it's rendered, not here. */
export type RequestsByOp = Record<string, number>;

// ---- View models (client-facing; joins across friend/instance/activity/usage) ----
// Defined structurally here (not imported from the server Schema) so the client
// package can use them without depending on Drizzle.

/** Live activity, decoded for the UI (requestsByOp parsed from JSON). */
export type ActivityView = {
  requestsTotal: number;
  requestsByOp: RequestsByOp;
  requests24h: number;
  lastRequestAt: string | null;
  lastOp: string | null;
  bytesInTotal: number;
  bytesOutTotal: number;
  deniedCount: number;
  updatedAt: string;
};

/** Latest `mc du` sample paired with the quota for a usage bar. */
export type UsageView = {
  bytesUsed: number;
  objectCount: number;
  quotaBytes: number;
  /** 0..1; bytesUsed / quotaBytes, clamped. */
  fraction: number;
  checkedAt: string | null;
};

/** One row in the friends list (dashboard). */
export type FriendListItem = {
  id: number;
  name: string;
  isolationMode: IsolationMode;
  status: FriendStatus;
  lockMode: LockMode;
  lockRetentionDays: number;
  usage: UsageView;
  requests24h: number;
  lastRequestAt: string | null;
};

/** Full friend-detail screen payload. */
export type FriendDetail = {
  id: number;
  name: string;
  isolationMode: IsolationMode;
  status: FriendStatus;
  bucket: string;
  s3AccessKeyId: string | null;
  tsNodeTag: string;
  lockMode: LockMode;
  lockRetentionDays: number;
  // Endpoint/connection facts resolved from the friend's instance.
  s3Endpoint: string;
  instanceKind: InstanceKind;
  instanceStatus: InstanceStatus;
  nodeOnline: boolean;
  usage: UsageView;
  activity: ActivityView;
};

/** One row on the ops/Status page (a MinIO instance, a node, or a host daemon). */
export type ServiceStatus = {
  name: string;
  detail: string;
  /** `provisioning` while coming up (not yet healthy); `pending` while being
   * torn down (instance `reaping`) — transitional, not a fault. */
  state: "up" | "provisioning" | "pending" | "down";
  /** Instance hostname for `status.diagnose`; absent for host rows. */
  instance?: string;
};

/** System inventory for the Status page — grouped service health. */
export type StatusView = {
  minio: ServiceStatus[];
  tailscale: ServiceStatus[];
  host: ServiceStatus[];
};

// ============================================================================
// Router contract — the tRPC AppRouter implements this shape. Documented here
// as a reference; tRPC infers the live types from the server implementation.
// ============================================================================
//
//   friends.list      ()                         -> FriendListItem[]
//   friends.get       (getFriendInput)           -> FriendDetail
//   friends.add       (addFriendInput)           -> FriendBundle      (once)
//   friends.resize    (resizeFriendInput)        -> FriendDetail
//   friends.rotateKey (rotateKeyInput)           -> FriendBundle      (once)
//   friends.suspend   (suspendFriendInput)       -> FriendDetail
//   friends.resume    (resumeFriendInput)        -> FriendDetail
//   friends.offboard  (offboardFriendInput)      -> { ok: true }
//   usage.history     (usageHistoryInput)        -> UsageView[]
//   activity.stream   (getFriendInput)           -> SSE<ActivityView> (subscription)
//   status.get        ()                         -> StatusView
