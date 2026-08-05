import { z } from "zod";

export const ISOLATION_MODE_VALUES = ["dedicated", "shared"] as const;
export type IsolationMode = (typeof ISOLATION_MODE_VALUES)[number];
export const isolationModeSchema = z.enum(ISOLATION_MODE_VALUES);

export const INSTANCE_KIND_VALUES = ISOLATION_MODE_VALUES;
export type InstanceKind = IsolationMode;

export const ENROLLMENT_MODE_VALUES = ["authKey", "invite"] as const;
export type EnrollmentMode = (typeof ENROLLMENT_MODE_VALUES)[number];

/** The friend's email doubles as the invite recipient and the login identity used for the ACL grant. */
export const emailSchema: z.ZodString = z.string().trim().email().max(254);

export const enrollmentSchema: z.ZodDiscriminatedUnion<"mode", [
  z.ZodObject<{ mode: z.ZodLiteral<"authKey"> }>,
  z.ZodObject<{ mode: z.ZodLiteral<"invite">; email: typeof emailSchema }>,
]> = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("authKey") }),
  z.object({ mode: z.literal("invite"), email: emailSchema }),
]);
export type Enrollment = z.infer<typeof enrollmentSchema>;

/**
 * Provisioning normally moves to active; a crash instead leaves the row as
 * failed for the cleanup sweep to reap. Suspend and offboard are admin actions.
 */
export const FRIEND_STATUS_VALUES = [
  "provisioning",
  "active",
  "suspended",
  "offboarding",
  "failed",
] as const;
export type FriendStatus = (typeof FRIEND_STATUS_VALUES)[number];

export const AUDIT_ACTION_VALUES = [
  "add_friend",
  "resize",
  "rotate_key",
  "reissue_ts_key",
  "suspend",
  "resume",
  "offboard",
  "instance_recovered",
  "instance_data_lost",
  // The instance's serve node couldn't reclaim its assigned tailnet hostname
  // because another ONLINE device holds it — a real, unexplained collision,
  // not a stale leftover. The instance may be reachable on a different
  // (suffixed) hostname than its bundle promised.
  "instance_hostname_unclaimed",
  "instance_hostname_accepted",
  "login",
  "logout",
  // Recorded for any admin mutation that errors; the failing path and reason
  // ride in `detail`.
  "action_failed",
] as const;
export type AuditAction = (typeof AUDIT_ACTION_VALUES)[number];

export const INSTANCE_STATUS_VALUES = [
  "provisioning",
  "active",
  "stopped",
  // Marked atomically, while counting friends, before teardown begins, so a
  // concurrent add can never adopt an instance that is about to be removed.
  "reaping",
  "failed",
] as const;
export type InstanceStatus = (typeof INSTANCE_STATUS_VALUES)[number];

/**
 * GOVERNANCE, the default, can be bypassed by server root when offboarding.
 * COMPLIANCE cannot be deleted even by us and is opt-in, since it blocks offboarding.
 */
export const LOCK_MODE_VALUES = ["GOVERNANCE", "COMPLIANCE"] as const;
export type LockMode = (typeof LOCK_MODE_VALUES)[number];
export const lockModeSchema = z.enum(LOCK_MODE_VALUES);

/** min(3) is MinIO's bucket-name minimum, since the name becomes the bucket
 * name itself. max(50) leaves headroom in the 63-character DNS label for the
 * `p0rt1on-` prefixes added to container and volume names. */
const friendNameSchema: z.ZodString = z
  .string()
  .min(3, "at least 3 characters (it becomes the S3 bucket name)")
  .max(50, "at most 50 characters (it becomes part of DNS/container names)")
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "lowercase letters/digits/hyphens, starting and ending with a letter or digit",
  );

/** A byte count. SQLite INTEGER is 64-bit, so raw bytes are safe. */
const byteCountSchema: z.ZodNumber = z.number().int().positive();

const retentionDaysSchema: z.ZodNumber = z.number().int().min(1).max(36500);

export const addFriendInput: z.ZodObject<{
  name: typeof friendNameSchema;
  quotaBytes: typeof byteCountSchema;
  retentionDays: typeof retentionDaysSchema;
  isolationMode: typeof isolationModeSchema;
  lockMode: z.ZodDefault<typeof lockModeSchema>;
  enrollment: z.ZodDefault<typeof enrollmentSchema>;
}> = z.object({
  name: friendNameSchema,
  quotaBytes: byteCountSchema,
  retentionDays: retentionDaysSchema,
  isolationMode: isolationModeSchema,
  lockMode: lockModeSchema.default("GOVERNANCE"),
  enrollment: enrollmentSchema.default({ mode: "authKey" }),
});

export type AddFriendInput = z.infer<typeof addFriendInput>;

const friendIdSchema: z.ZodNumber = z.number().int().positive();

/** Resizing takes effect immediately; shrinking the quota below current usage does not delete data, it just rejects new PUTs. */
export const resizeFriendInput: z.ZodObject<{
  friendId: typeof friendIdSchema;
  quotaBytes: typeof byteCountSchema;
}> = z.object({ friendId: friendIdSchema, quotaBytes: byteCountSchema });
export type ResizeFriendInput = z.infer<typeof resizeFriendInput>;

/** Also the lost-key recovery path; returns a once-shown secret that is never persisted. */
export const rotateKeyInput: z.ZodObject<{ friendId: typeof friendIdSchema }> =
  z
    .object({ friendId: friendIdSchema });
export type RotateKeyInput = z.infer<typeof rotateKeyInput>;

export const reissueTsKeyInput: z.ZodObject<
  { friendId: typeof friendIdSchema }
> = z.object({ friendId: friendIdSchema });
export type ReissueTsKeyInput = z.infer<typeof reissueTsKeyInput>;

export const suspendFriendInput: z.ZodObject<
  { friendId: typeof friendIdSchema }
> = z.object({ friendId: friendIdSchema });
export type SuspendFriendInput = z.infer<typeof suspendFriendInput>;

export const resumeFriendInput: z.ZodObject<
  { friendId: typeof friendIdSchema }
> = z.object({ friendId: friendIdSchema });
export type ResumeFriendInput = z.infer<typeof resumeFriendInput>;

export const offboardFriendInput: z.ZodObject<{
  friendId: typeof friendIdSchema;
}> = z.object({ friendId: friendIdSchema });
export type OffboardFriendInput = z.infer<typeof offboardFriendInput>;

export const getFriendInput: z.ZodObject<{ friendId: typeof friendIdSchema }> =
  z
    .object({ friendId: friendIdSchema });
export type GetFriendInput = z.infer<typeof getFriendInput>;

export const jobIdSchema: z.ZodString = z.string().uuid();

export const jobInput: z.ZodObject<{ jobId: typeof jobIdSchema }> = z.object({
  jobId: jobIdSchema,
});

export type JobInput = z.infer<typeof jobInput>;

export const usageHistoryInput: z.ZodObject<{
  friendId: typeof friendIdSchema;
  limit: z.ZodDefault<z.ZodNumber>;
}> = z.object({
  friendId: friendIdSchema,
  limit: z.number().int().min(1).max(500).default(100),
});

export type UsageHistoryInput = z.infer<typeof usageHistoryInput>;

/** `before` pages backward using the id cursor of the last row already shown, for the load-older button. */
export const auditListInput: z.ZodObject<{
  limit: z.ZodDefault<z.ZodNumber>;
  before: z.ZodOptional<z.ZodNumber>;
}> = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  before: z.number().int().positive().optional(),
});

export type AuditListInput = z.infer<typeof auditListInput>;

/**
 * The secrets here exist only in this response and are never persisted.
 * rotateKey omits the Tailscale fields since the friend's node is already enrolled.
 */
export type FriendBundle = {
  name: string;
  s3Endpoint: string;
  bucket: string;
  s3AccessKeyId: string;
  s3SecretKey: string; // shown once
  enrollmentMode?: EnrollmentMode; // undefined means legacy authKey enrollment
  tsAuthKey?: string; // shown once
  tailscaleUpCommand?: string;
  inviteEmail?: string;
  /** Not a secret, so safe to log or display freely. */
  inviteUrl?: string;
  inviteEmailedAt?: string;
  manualInviteInstructions?: string;
  manualAclInstructions?: string;
  kopiaQuickstart: string;
  /**
   * Non-fatal degradations the admin should know about, since the operation
   * still succeeded. These must be surfaced to the admin, never hidden in logs.
   */
  warnings?: string[];
};

export {
  OFFBOARD_STEPS,
  type OffboardStepKey,
  type ProgressStep,
  PROVISION_STEPS,
  type ProvisionStepKey,
} from "./steps.ts";

/**
 * Both fields are advisory only, listing manual cleanup steps for manual ACL
 * mode or a no-token invite; the offboard itself has already completed.
 */
export type OffboardResult = {
  manualAclCleanup?: string;
  manualUserRemoval?: string;
};

/** `inviteApiConfigured` reflects only that a token is set, not that it is
 * still valid, so the invite pre-submit warning is a hint, not a guarantee. */
export type ManagerCapabilities = { inviteApiConfigured: boolean };

export const INVITE_STATUS_VALUES = [
  "pending",
  "accepted",
  "expired",
  "manual",
] as const;
export type InviteStatus = (typeof INVITE_STATUS_VALUES)[number];

export type InviteStatusView = {
  status: InviteStatus;
  email: string;
  /** Not a secret while pending, so safe to display or log. */
  inviteUrl?: string;
  emailedAt?: string;
};

/** Shown once; tsAuthKey here is never persisted. */
export type TsKeyBundle = {
  name: string;
  tsAuthKey: string;
  tailscaleUpCommand: string;
};

/** Serialized to JSON in the `activity.requestsByOp` column. Any display-time
 * grouping happens where it is rendered, not here. */
export type RequestsByOp = Record<string, number>;

// Defined structurally here rather than imported from the server Schema, so
// the client package can use these types without depending on Drizzle.
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

/** `friend` is null for system/instance events and for offboarded friends,
 * since the audit row survives the friend's deletion. */
export type AuditEntryView = {
  id: number;
  when: string;
  action: AuditAction;
  friend: string | null;
  detail: string | null;
};

export type UsageView = {
  bytesUsed: number;
  objectCount: number;
  quotaBytes: number;
  /** Ranges 0 to 1: bytesUsed divided by quotaBytes, clamped. */
  fraction: number;
  checkedAt: string | null;
};

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
  enrollmentMode: EnrollmentMode;
  /** Null for authKey friends, since only invite enrollment has an invite to track. */
  inviteStatus: InviteStatus | null;
  hostnameWarning: string | null;
};

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
  s3Endpoint: string;
  instanceKind: InstanceKind;
  instanceStatus: InstanceStatus;
  nodeOnline: boolean;
  usage: UsageView;
  activity: ActivityView;
};

export type ServiceStatus = {
  name: string;
  detail: string;
  /** `pending` (instance reaping) and `provisioning` are transitional, not
   * faults. `lost` means a down instance whose data is also gone, so its
   * backups are unrecoverable, unlike a `down` instance whose data survives. */
  state: "up" | "provisioning" | "pending" | "down" | "lost";
  instance?: string;
  /** Last 24 hours of hourly request counts, ordered oldest to newest; absent
   * for rows with no activity. */
  spark?: number[];
};

export type StatusView = {
  minio: ServiceStatus[];
  tailscale: ServiceStatus[];
  host: ServiceStatus[];
};

/** `blocked` is a hard misconfiguration that gates portion creation. `warn`
 * is a caveat that cannot be proven either way, so it is surfaced, not blocked. */
export type HealthStatus = "ok" | "warn" | "blocked";
export type HealthCheckId =
  | "tailscaleApi"
  | "magicDns"
  | "serveTag"
  | "httpsServe"
  | "managerService"
  | "instanceImage"
  | "pantry"
  | "podSecurity";
export type HealthCheck = {
  id: HealthCheckId;
  status: HealthStatus;
  title: string;
  detail: string;
  fixUrl?: string;
};

export type SystemHealth = {
  checks: HealthCheck[];
  /** False when any check is `blocked`; disables the "Add portion" action. */
  canProvision: boolean;
  probedAt: string;
};
