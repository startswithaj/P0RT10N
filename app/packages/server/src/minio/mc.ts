import type { LockMode } from "@p0rt1on/shared/domain";

export interface McTarget {
  /** Equals the instance's tailnet hostname; also the root-cred derivation
   * input. */
  alias: string;
  /** Host-published admin-plane port (composes the MC_HOST endpoint). */
  minioPort: number;
}

export interface DuResult {
  bytesUsed: number;
  objectCount: number;
}

/** The secret is held only transiently, never persisted. */
export interface S3Credential {
  accessKeyId: string;
  secretKey: string;
}

/** One IAM user as reported by `mc admin user list` (no secret material). */
export interface UserEntry {
  accessKeyId: string;
  policies: string[];
}

/** Impls run the corresponding `mc` command; all throw ServiceError on
 * non-zero exit. */
export interface McClient {
  readonly target: McTarget;

  // ---- Bucket lifecycle ----

  /** `mc mb --with-lock <alias>/<bucket>`; enables both versioning and Object
   * Lock. */
  makeBucketWithLock(bucket: string): Promise<void>;

  /** Offboard only; deletes all objects/versions (root bypasses GOVERNANCE). */
  removeBucket(bucket: string): Promise<void>;

  // ---- Immutability + sizing (per-bucket) ----

  /** `mc retention set --default <mode> "<days>d" <alias>/<bucket>`. Arm AFTER smoke-test. */
  setDefaultRetention(
    bucket: string,
    mode: LockMode,
    days: number,
  ): Promise<void>;

  setHardQuota(bucket: string, bytes: number): Promise<void>;

  du(bucket: string): Promise<DuResult>;

  // ---- User + policy (least-privilege, bucket-scoped) ----

  /** `mc admin user add`. Does NOT attach a policy — call putBucketScopedPolicy
   * + attachPolicy after. */
  createUser(cred: S3Credential): Promise<void>;

  /** Create/replace a least-privilege single-bucket policy: CRUD plus **deny
   * `s3:BypassGovernanceRetention`**. */
  putBucketScopedPolicy(policyName: string, bucket: string): Promise<void>;
  attachPolicy(accessKeyId: string, policyName: string): Promise<void>;

  /** `mc admin policy rm` — "already absent" is success. */
  removePolicy(policyName: string): Promise<void>;

  disableUser(accessKeyId: string): Promise<void>;
  enableUser(accessKeyId: string): Promise<void>;

  removeUser(accessKeyId: string): Promise<void>;

  listUsers(): Promise<UserEntry[]>;

  // ---- Observability ----

  /** Set the audit_webhook config and restart MinIO. Idempotent per
   * instance. */
  setAuditWebhook(endpoint: string, authToken: string): Promise<void>;

  /** `mc admin trace --json` as an async stream; aborts (kills the child) when
   * `signal` fires. */
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

export interface McClientFactory {
  forInstance(target: McTarget): McClient;
}
