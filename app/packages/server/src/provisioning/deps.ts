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

export interface ProvisioningConfig {
  instanceImage: string;
  instanceAddressing: InstanceAddressing;
  /** Inclusive host-port range dedicated instances are allocated from. */
  portRange: { min: number; max: number };
  sharedInstanceName: string;
  /** `https` serves on 443 with control-plane certs; `http` serves on 80 for
   * headscale, which can't issue certs. Drives both the friend endpoint scheme
   * and the ACL grant port. */
  serveMode: "https" | "http";
  /** Tag for the SERVER-side `serve` node — distinct from the friend's client
   * `tag:p0rt1on-friend-<name>`. */
  serveNodeTag: string;
  /** `auto` edits the tailnet policy via API (needs policy_file write); `manual`
   * surfaces the grant lines for the admin to paste. */
  aclMode: "auto" | "manual";
  /** Internal audit-webhook receiver URL + guard token (not on any tailnet). */
  auditWebhookUrl: string;
  auditWebhookToken: string;
}

export interface FriendNaming {
  bucket: string;
  nodeTag: string; // `tag:p0rt1on-friend-<name>`
  tsHostname: string; // dedicated: the friend's own hostname; shared: the pool's
}

export interface InstanceReservation {
  friendId: number;
  instanceId: number;
  alias: string;
  hostPort: number;
  tsHostname: string;
  instanceExisted: boolean;
}

/** Carries no secret (access key ID only). */
export interface FriendProvisionContext {
  friendId: number;
  name: string;
  isolationMode: IsolationMode;
  bucket: string;
  s3AccessKeyId: string | null;
  /** Tailscale auth-key ID (never the secret); null for friends created
   * before this column existed. */
  tsKeyId: string | null;
  nodeTag: string;
  enrollmentMode: EnrollmentMode;
  /** Invite mode only. */
  inviteEmail: string | null;
  inviteId: string | null;
  lockMode: LockMode;
  lockRetentionDays: number;
  instanceId: number;
  instanceName: string;
  alias: string;
  tsHostname: string;
  /** The serve node's stable tailnet ID (null for rows created before this
   * column existed); offboard deletes by it. */
  serveNodeId: string | null;
  /** Host-published admin-plane port (composes the per-call MC_HOST endpoint). */
  minioPort: number;
}

export interface ProvisioningRepo {
  /** Atomically persist the friend row (status `provisioning`) and resolve its
   * instance: `dedicated` allocates a free port and a new instance, `shared`
   * looks up or creates the pool. */
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

  recordServeNodeId(instanceId: number, serveNodeId: string): Promise<void>;

  /** Repins the instance's stored tsHostname to whatever was actually
   * confirmed (Tailscale can grant a collision suffix instead). */
  recordConfirmedHostname(
    instanceId: number,
    tsHostname: string,
  ): Promise<void>;

  /** Atomically count live friends and mark the instance `reaping`; returns
   * false when `requireEmpty` is set and friends remain. Once marked, reserve
   * refuses to adopt the instance, so an add can't race the reap. */
  markInstanceReaping(
    instanceId: number,
    opts: { requireEmpty: boolean },
  ): Promise<boolean>;

  setQuota(friendId: number, quotaBytes: number): Promise<void>;

  setStatus(friendId: number, status: FriendStatus): Promise<void>;

  /** Flip the friend and its instance to `active`; a no-op if they already
   * are. */
  activate(friendId: number, instanceId: number): Promise<void>;

  /** Flip the friend (and a brand-new instance) to `failed` for the cleanup
   * sweep. */
  markFailed(friendId: number): Promise<void>;

  context(friendId: number): Promise<FriendProvisionContext>;

  /** Counts other non-`failed` friends sharing an invite email; guards against
   * deleting a tailnet user another portion still depends on. */
  otherFriendsWithInviteEmail(
    excludeFriendId: number,
    email: string,
  ): Promise<number>;

  friendsOnInstance(instanceId: number): Promise<number>;

  /** Node tags of non-`failed` friends. */
  liveFriendTagsOnInstance(instanceId: number): Promise<string[]>;

  failedFriendIds(): Promise<number[]>;

  /** Boot recovery: flip every stale `provisioning` friend (and its now-empty
   * instance) to `failed` for the sweep. Returns the names for logging. */
  failStaleProvisioning(): Promise<string[]>;

  failedInstances(): Promise<
    { instanceId: number; tsHostname: string; serveNodeId: string | null }[]
  >;

  liveInstances(): Promise<
    {
      instanceId: number;
      tsHostname: string;
      minioPort: number;
      status: string;
      serveNodeId: string | null;
    }[]
  >;

  /** When the container is gone, fail the instance and all its non-failed
   * friends in one transaction so the sweep reaps the rows. Returns how many
   * friends were failed. */
  failInstanceMissing(instanceId: number): Promise<number>;

  deleteFriend(friendId: number): Promise<void>;

  deleteInstance(instanceId: number): Promise<void>;

  audit(
    friendId: number | null,
    action: AuditAction,
    detail?: string,
  ): Promise<void>;

  /** Most recent hostname-related audit row for a friend, or undefined if it
   * has none. The hostname check reads this instead of holding its own state,
   * so a manager restart doesn't re-announce a mismatch it already recorded. */
  lastHostnameEvent(
    friendId: number,
  ): Promise<{ action: AuditAction; detail: string | null } | undefined>;
}

/** Secrets are transient, never persisted to the DB. */
export interface KeyGen {
  generateS3Credential(): S3Credential;
  /** **Deterministically derived** from master key + host — stable across
   * recreations, recoverable after restart, never stored per-instance. */
  rootCredentialFor(instanceHost: string): S3Credential;
}

export interface SmokeTestParams {
  endpoint: string;
  bucket: string;
  cred: S3Credential;
}

/** In-memory Put→Get→Delete with a new key. MUST run BEFORE default retention
 * is armed, so the test object's delete isn't blocked by Object Lock. */
export interface SmokeTester {
  run(params: SmokeTestParams): Promise<void>;
}
