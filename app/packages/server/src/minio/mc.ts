import type { LockMode } from "@p0rt1on/shared/domain";

// ============================================================================
// `mc` (MinIO Client) admin wrapper — the only place that shells out to mc.
// Every method targets one instance by `alias`. Root creds are derived from
// the master key per call and ride a `MC_HOST_<alias>` env var (never argv,
// never `~/.mc` state, never persisted) — keeping the no-secrets-in-DB /
// zero-knowledge invariants and hiding secrets from host `ps`.
// ============================================================================

/** One MinIO instance as an mc target (root creds derived per call). */
export interface McTarget {
  /** = the instance's tailnet hostname; also the root-cred derivation input. */
  alias: string;
  /** Host-published admin-plane port (composes the MC_HOST endpoint). */
  minioPort: number;
}

/** Result of `mc du` on a bucket. */
export interface DuResult {
  bytesUsed: number;
  objectCount: number;
}

/** An S3 credential pair. The secret is held only transiently, never persisted. */
export interface S3Credential {
  accessKeyId: string;
  secretKey: string;
}

/** One IAM user as reported by `mc admin user list` (no secret material). */
export interface UserEntry {
  accessKeyId: string;
  /** Policy names attached to the user (mc reports them comma-separated). */
  policies: string[];
}

/**
 * MinIO admin operations, scoped to a single instance. Implementations run the
 * corresponding `mc` command and parse `--json` output. All throw a ServiceError
 * on non-zero exit so the service layer / tRPC middleware can surface it.
 */
export interface McClient {
  readonly target: McTarget;

  // ---- Bucket lifecycle ----

  /** `mc mb --with-lock <alias>/<bucket>` — versioning + Object Lock enabled. */
  makeBucketWithLock(bucket: string): Promise<void>;

  /** `mc rb --force <alias>/<bucket>` — offboard only; deletes all objects/versions. */
  removeBucket(bucket: string): Promise<void>;

  // ---- Immutability + sizing (per-bucket) ----

  /** `mc retention set --default <mode> "<days>d" <alias>/<bucket>`. Arm AFTER smoke-test. */
  setDefaultRetention(
    bucket: string,
    mode: LockMode,
    days: number,
  ): Promise<void>;

  /** `mc admin bucket quota --hard <bytes> <alias>/<bucket>` — effective immediately. */
  setHardQuota(bucket: string, bytes: number): Promise<void>;

  /** `mc du --json <alias>/<bucket>`. */
  du(bucket: string): Promise<DuResult>;

  // ---- User + policy (least-privilege, bucket-scoped) ----

  /**
   * `mc admin user add <alias> <accessKeyId> <secretKey>`. The caller generates
   * the pair (KeyGen); this layer is MinIO-only and returns nothing — the
   * Tailscale auth key is a separate concern (TailscaleApi.mintAuthKey). Does NOT
   * attach a policy — call putBucketScopedPolicy + attachPolicy after.
   */
  createUser(cred: S3Credential): Promise<void>;

  /**
   * Create/replace a least-privilege policy scoped to one bucket
   * (Put/Get/List/Delete, **deny `s3:BypassGovernanceRetention`**) and attach it
   * to the user. `policyName` is typically the friend's bucket name.
   */
  putBucketScopedPolicy(policyName: string, bucket: string): Promise<void>;
  attachPolicy(accessKeyId: string, policyName: string): Promise<void>;

  /** `mc admin policy rm` — offboard; "already absent" is success. */
  removePolicy(policyName: string): Promise<void>;

  /** `mc admin user disable/enable` — suspend / resume without deleting. */
  disableUser(accessKeyId: string): Promise<void>;
  enableUser(accessKeyId: string): Promise<void>;

  /** `mc admin user remove` — offboard, and the old half of a key rotation. */
  removeUser(accessKeyId: string): Promise<void>;

  /**
   * `mc admin user list --json <alias>` — every IAM user with its attached
   * policy names. MinIO is the source of truth for which users belong to a
   * friend (users attached to the friend's bucket-scoped policy), so stale
   * credentials from a failed rotation are discoverable without DB state.
   */
  listUsers(): Promise<UserEntry[]>;

  // ---- Observability ----

  /**
   * `mc admin config set <alias> audit_webhook endpoint=<url> auth_token=<tok>` +
   * restart. Idempotent per instance (the shared pool sets it once).
   */
  setAuditWebhook(endpoint: string, authToken: string): Promise<void>;

  /**
   * `mc admin trace --json <alias>` as an async stream for the live tail. Aborts
   * (kills the child) when `signal` fires.
   */
  trace(signal: AbortSignal): AsyncIterable<TraceEvent>;
}

/** One decoded `mc admin trace` line (subset we surface to the UI). */
export interface TraceEvent {
  time: string;
  api: string;
  bucket: string;
  object: string;
  statusCode: number;
  callStats?: { rx: number; tx: number; duration: string };
}

/**
 * Builds an McClient for a given instance target (derives root creds itself).
 * Endpoint composition is the RUNTIME's job (`InstanceRuntime.adminEndpoint`)
 * — the factory is wired with it at boot.
 */
export interface McClientFactory {
  forInstance(target: McTarget): McClient;
}
