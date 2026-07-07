import type {
  AddFriendInput,
  FriendStatus,
  IsolationMode,
  LockMode,
} from "@p0rt1on/shared/domain";
import type { S3Credential } from "../minio/mc.ts";

// ============================================================================
// Dependencies the ProvisioningService orchestrates. Each is an interface so
// the state machine stays pure orchestration — testable with mocks, and the
// concrete impls (Drizzle repo, real `mc`/runtime/tailscale) plug in later.
// ============================================================================

/** Static config supplied at boot (env / mounted). No secrets persisted to DB. */
export interface ProvisioningConfig {
  /** Combined MinIO + tailscaled instance image (pinned). See `instance/`. */
  instanceImage: string;
  /** Docker network the instances join (they don't share it with the manager). */
  network: string;
  /**
   * Host address the manager reaches instances' published MinIO ports on —
   * `127.0.0.1` when the manager runs on the host, `host.docker.internal` when
   * it's itself a container. Instances publish `127.0.0.1:<hostPort>:<port>`.
   */
  instanceHost: string;
  region: string;
  /** Inclusive host-port range dedicated instances are allocated from. */
  portRange: { min: number; max: number };
  /** The single shared pool's instance name (PLAN: one shared pool for v1). */
  sharedInstanceName: string;
  /** Tailnet base, e.g. `tailXXXX.ts.net`; endpoint = `<tsHostname>.<this>`. */
  tailnetDomain: string;
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
  nodeTag: string;
  lockMode: LockMode;
  lockRetentionDays: number;
  instanceId: number;
  instanceName: string;
  alias: string;
  tsHostname: string;
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

  /** Count of non-`failed` friends still on an instance (offboard reaping). */
  friendsOnInstance(instanceId: number): Promise<number>;

  /** Friend IDs left in `failed` state — tombstones for the cleanup sweep. */
  failedFriendIds(): Promise<number[]>;

  /**
   * Boot recovery: flip every stale `provisioning` friend (and its
   * now-empty instance, matching markFailed semantics) to `failed` so the
   * sweep reaps them. Returns the affected friend names for logging.
   */
  failStaleProvisioning(): Promise<string[]>;

  /** Instances left in `failed` state — for reaping orphaned containers/volumes. */
  failedInstances(): Promise<{ instanceId: number; tsHostname: string }[]>;

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

  /** Append an `audit` row for an admin action. */
  audit(
    friendId: number | null,
    action: string,
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
  region: string;
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
