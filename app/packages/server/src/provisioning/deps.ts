import type {
  AddFriendInput,
  AuditAction,
  EnrollmentMode,
  FriendStatus,
  IsolationMode,
  LockMode,
} from "@p0rt1on/shared/domain";
import type { S3Credential } from "../minio/mc.ts";
import type { InstanceAddressing } from "../runtime/adminEndpoint.ts";

// ============================================================================
// Dependencies the ProvisioningService orchestrates. Each is an interface so
// the state machine stays pure orchestration — testable with mocks, and the
// concrete impls (Drizzle repo, real `mc`/runtime/tailscale) plug in later.
// ============================================================================

/** Static config supplied at boot (env / mounted). No secrets persisted to DB. */
export interface ProvisioningConfig {
  /** Combined MinIO + tailscaled instance image (pinned). See `instance/`. */
  instanceImage: string;
  /**
   * How the manager reaches instances' MinIO admin plane: `host` (loopback-
   * published port, host-run dev) or `network` (by container name over the
   * shared docker network, containerized manager). See runtime/adminEndpoint.ts.
   */
  instanceAddressing: InstanceAddressing;
  /** Inclusive host-port range dedicated instances are allocated from. */
  portRange: { min: number; max: number };
  /** The single shared pool's instance name (PLAN: one shared pool for v1). */
  sharedInstanceName: string;
  /**
   * How instances publish MinIO on the tailnet: `https` (tailscale serve with
   * control-plane certs, port 443) or `http` (port 80 — control planes
   * without cert issuance, i.e. headscale). Drives BOTH the friend endpoint
   * scheme and the ACL grant port; instances read the same value via
   * `TAILSCALE_SERVE_MODE`.
   */
  serveMode: "https" | "http";
  /**
   * Tag for the SERVER-side tailscaled we run (the `serve` node) — distinct from
   * the friend's client `tag:p0rt1on-friend-<name>`. Used to mint that container's own
   * auth key when starting a new instance.
   */
  serveNodeTag: string;
  /**
   * ACL management: `auto` edits the tailnet policy via the API (needs
   * policy_file write); `manual` skips it and surfaces the grant lines for the
   * admin to paste (for tokens without that scope). See [[manual-acl-mode]].
   */
  aclMode: "auto" | "manual";
  /** Internal audit-webhook receiver URL + guard token (not on any tailnet). */
  auditWebhookUrl: string;
  auditWebhookToken: string;
}

/** Derived names for a friend (bucket, node tag, instance hostname). */
export interface FriendNaming {
  bucket: string;
  nodeTag: string; // `tag:p0rt1on-friend-<name>`
  tsHostname: string; // dedicated: the friend; shared: the pool's hostname
}

/** Outcome of the atomic "reserve first" step (PLAN provisioning step 1). */
export interface InstanceReservation {
  friendId: number;
  instanceId: number;
  alias: string; // mc alias for the instance
  hostPort: number;
  tsHostname: string;
  /** True when the shared pool was already running (skip container start). */
  instanceExisted: boolean;
}

/**
 * Everything rotate/offboard need about an existing friend, resolved by joining
 * the friend + its instance. Carries no secret (access key ID only).
 */
export interface FriendProvisionContext {
  friendId: number;
  name: string;
  isolationMode: IsolationMode;
  bucket: string;
  s3AccessKeyId: string | null;
  /** Tailscale auth-key ID (never the secret); null pre-column friends. */
  tsKeyId: string | null;
  nodeTag: string;
  enrollmentMode: EnrollmentMode;
  /** Invite mode only; null for authKey friends. */
  inviteEmail: string | null;
  inviteId: string | null;
  lockMode: LockMode;
  lockRetentionDays: number;
  instanceId: number;
  instanceName: string;
  alias: string;
  tsHostname: string;
  /** Serve node's stable tailnet ID; null pre-column. Offboard deletes by it. */
  serveNodeId: string | null;
  /** Host-published admin-plane port (composes the per-call MC_HOST endpoint). */
  minioPort: number;
}

/**
 * Metadata persistence for provisioning. Implemented over Drizzle; mutations
 * that must be atomic (reserve) run in a transaction inside the impl.
 */
export interface ProvisioningRepo {
  /**
   * Atomically persist the friend row (status `provisioning`) and resolve its
   * instance: allocate a free port + new instance for `dedicated`, or look up /
   * create the shared instance for `shared`.
   */
  reserveFriend(
    input: AddFriendInput,
    naming: FriendNaming,
  ): Promise<InstanceReservation>;

  /** Persist the access key **ID** (never the secret) once the user exists. */
  recordAccessKey(friendId: number, accessKeyId: string): Promise<void>;

  /** Persist the Tailscale auth-key **ID** (never the secret) at mint time. */
  recordTsKeyId(friendId: number, tsKeyId: string): Promise<void>;

  /** Persist invite-mode enrollment (also flips enrollmentMode to `invite`). */
  recordInvite(
    friendId: number,
    invite: { email: string; inviteId: string | null; status: string },
  ): Promise<void>;

  /** Persist the serve node's tailnet ID once it has enrolled. */
  recordServeNodeId(instanceId: number, serveNodeId: string): Promise<void>;

  /**
   * Atomically count live friends and mark the instance `reaping` (one
   * transaction). Returns false — nothing marked — when `requireEmpty` and
   * friends remain. Once marked, reserve refuses to adopt the instance, so
   * teardown can proceed without racing a concurrent add.
   */
  markInstanceReaping(
    instanceId: number,
    opts: { requireEmpty: boolean },
  ): Promise<boolean>;

  /** Update the friend's hard quota (resize). */
  setQuota(friendId: number, quotaBytes: number): Promise<void>;

  /** Update the friend's lifecycle status (suspend / resume). */
  setStatus(friendId: number, status: FriendStatus): Promise<void>;

  /** Flip friend → `active` and the instance → `active` (no-op if already). */
  activate(friendId: number, instanceId: number): Promise<void>;

  /** Flip friend (and a brand-new instance) → `failed` for the cleanup sweep. */
  markFailed(friendId: number): Promise<void>;

  /** Join friend + instance for rotate/offboard. */
  context(friendId: number): Promise<FriendProvisionContext>;

  /**
   * Count of OTHER non-`failed` friends sharing an invite email — offboard's
   * guard against deleting a tailnet user another portion still depends on.
   */
  otherFriendsWithInviteEmail(
    excludeFriendId: number,
    email: string,
  ): Promise<number>;

  /** Count of non-`failed` friends still on an instance (offboard reaping). */
  friendsOnInstance(instanceId: number): Promise<number>;

  /**
   * Node tags of the non-`failed` friends on an instance — boot recovery
   * re-applies each one's ACL grant after recreating the instance.
   */
  liveFriendTagsOnInstance(instanceId: number): Promise<string[]>;

  /** Friend IDs left in `failed` state — tombstones for the cleanup sweep. */
  failedFriendIds(): Promise<number[]>;

  /**
   * Boot recovery: flip every stale `provisioning` friend (and its
   * now-empty instance, matching markFailed semantics) to `failed` so the
   * sweep reaps them. Returns the affected friend names for logging.
   */
  failStaleProvisioning(): Promise<string[]>;

  /** Instances left in `failed` state — for reaping orphaned containers/volumes. */
  failedInstances(): Promise<
    { instanceId: number; tsHostname: string; serveNodeId: string | null }[]
  >;

  /** Every non-failed instance (id + address) — the boot reconcile's worklist. */
  liveInstances(): Promise<
    {
      instanceId: number;
      tsHostname: string;
      minioPort: number;
      status: string;
    }[]
  >;

  /**
   * The instance's container no longer exists: fail the instance and all its
   * non-failed friends (one transaction) so the sweep reaps the rows and
   * frees the names. Returns how many friends were failed.
   */
  failInstanceMissing(instanceId: number): Promise<number>;

  /** Remove the friend row (offboard). */
  deleteFriend(friendId: number): Promise<void>;

  /** Remove the instance row (offboard, last friend only). */
  deleteInstance(instanceId: number): Promise<void>;

  /** Append an `audit` row for a lifecycle event. `action` is a typed code
   * (AuditAction) so writers can't emit one the UI won't label. */
  audit(
    friendId: number | null,
    action: AuditAction,
    detail?: string,
  ): Promise<void>;
}

/** Generates credential pairs. Secrets are transient, never persisted to the DB. */
export interface KeyGen {
  /** A friend's least-privilege S3 user credential (random; rotatable). */
  generateS3Credential(): S3Credential;
  /**
   * An instance's MinIO root credential — **deterministically derived** from the
   * master key + instance host, so it's stable across container recreations and
   * recoverable after a manager restart (never stored per-instance). Same host →
   * same credential, always.
   */
  rootCredentialFor(instanceHost: string): S3Credential;
}

/** Parameters for the in-memory smoke-test of a freshly issued key. */
export interface SmokeTestParams {
  endpoint: string;
  bucket: string;
  cred: S3Credential;
}

/**
 * Exercises a new key end-to-end (`PutObject`→`GetObject`→`DeleteObject`) in
 * memory. MUST run BEFORE default retention is armed, so the test object's
 * delete isn't blocked by Object Lock. Throws on any failed step.
 */
export interface SmokeTester {
  run(params: SmokeTestParams): Promise<void>;
}
