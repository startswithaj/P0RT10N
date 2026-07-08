import type { LockMode } from "@p0rt1on/shared/domain";

// ============================================================================
// `mc` (MinIO Client) admin wrapper — the only place that shells out to mc.
// Every method targets one instance by its configured `alias`. Root creds are
// set out-of-band (`mc alias set <alias> …` from a mounted secret at boot), so
// this layer references the alias only and never holds or persists a secret —
// keeping the no-secrets-in-DB / zero-knowledge invariants.
// ============================================================================

/** A configured mc alias pointing at one MinIO instance (root creds out-of-band). */
export interface McTarget {
  alias: string;
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

/** Builds an McClient for a given instance alias. */
export interface McClientFactory {
  forInstance(target: McTarget): McClient;

  /**
   * Configure the `mc` alias for an instance (`mc alias set`), pointing at its
   * MinIO over the admin plane (docker network) with the root creds. Called once
   * when an instance's container is first created; subsequent `forInstance`
   * clients reuse the alias.
   */
  setAlias(alias: string, endpoint: string, cred: S3Credential): Promise<void>;
}
