import type {
  AddFriendInput,
  FriendBundle,
  InviteStatus,
  InviteStatusView,
  IsolationMode,
  OffboardResult,
  OffboardStepKey,
  ProvisionStepKey,
  TsKeyBundle,
} from "@p0rt1on/shared/domain";
import {
  buildKopiaQuickstart,
  kopiaInviteJoinLines,
  kopiaJoinLines,
} from "@p0rt1on/shared/kopiaQuickstart";
import type { ProvisioningService as ProvisioningServiceContract } from "../services/types.ts";
import type { Logger } from "../services/types.ts";
import type { McClient, McClientFactory, S3Credential } from "../minio/mc.ts";
import type { InstanceRuntime, InstanceSpec } from "../runtime/runtime.ts";
import type { TailscaleApi } from "../tailscale/tailscale.ts";
import { serveEndpoint } from "../tailscale/serveEndpoint.ts";
import type { UserInviteApi } from "../tailscale/userInvite.ts";
import {
  manualAclInstructions,
  manualAclRemovalInstructions,
} from "../tailscale/manualAcl.ts";
import {
  manualInviteInstructions,
  manualUserRemovalInstructions,
} from "../tailscale/manualInvite.ts";
import { ConflictError, ServiceError } from "../lib/ServiceError.ts";
import { drainForResult } from "../lib/drainGenerator.ts";
import { Mutex } from "../lib/Mutex.ts";
import type { ProgressEvent, StepEvent } from "../lib/progress.ts";
import type {
  FriendNaming,
  FriendProvisionContext,
  InstanceReservation,
  KeyGen,
  ProvisioningConfig,
  ProvisioningRepo,
  SmokeTester,
} from "./deps.ts";
import type { MinioEventAggregator } from "../minio-events/MinioEventAggregator.ts";

/** MinIO enqueues audit entries and flushes them from a background goroutine,
 * so the event has not necessarily reached the manager the instant the smoke
 * test's `mc` exits. Re-read a few times rather than once: the healthy path
 * returns on the first attempt and waits not at all. */
const AUDIT_READ_ATTEMPTS = 5;
const AUDIT_READ_GAP_MS = 300;

type InstanceRef = {
  instanceId: number;
  tsHostname: string;
  minioPort: number;
};

/** In invite mode, manualInstructions replaces the invite link when no invite
 * token is configured or creating the invite failed. */
type EnrollmentResult =
  | { mode: "authKey"; tsAuthKey: string }
  | {
    mode: "invite";
    email: string;
    inviteUrl?: string;
    inviteEmailedAt?: string;
    manualInstructions?: string;
    warning?: string;
  };

export class ProvisioningService implements ProvisioningServiceContract {
  // Serializes mutating ops (add/offboard/rotate/sweep) to rule out
  // interleavings like reap-vs-add without distributed locking; read-only
  // queries never take it.
  private readonly mutex = new Mutex();

  constructor(
    private readonly config: ProvisioningConfig,
    private readonly repo: ProvisioningRepo,
    private readonly mc: McClientFactory,
    private readonly runtime: InstanceRuntime,
    private readonly tailscale: TailscaleApi,
    private readonly userInvite: UserInviteApi,
    private readonly keyGen: KeyGen,
    private readonly smokeTester: SmokeTester,
    private readonly aggregator: MinioEventAggregator,
    private readonly logger: Logger,
  ) {}

  addFriend(input: AddFriendInput): Promise<FriendBundle> {
    return drainForResult(this.addFriendStream(input));
  }

  addFriendStream(
    input: AddFriendInput,
  ): AsyncGenerator<ProgressEvent<ProvisionStepKey, FriendBundle>> {
    return this.mutex.runStream(() => this.addFriendLocked(input));
  }

  private async *addFriendLocked(
    input: AddFriendInput,
  ): AsyncGenerator<ProgressEvent<ProvisionStepKey, FriendBundle>> {
    const log = this.logger.child({ op: "addFriend", name: input.name });
    log.info("provisioning started", {
      isolationMode: input.isolationMode,
      quotaBytes: input.quotaBytes,
      retentionDays: input.retentionDays,
    });
    const naming = this.buildNaming(input.name, input.isolationMode);
    const reservation = await this.repo.reserveFriend(input, naming);
    log.debug("friend reserved", {
      friendId: reservation.friendId,
      instanceId: reservation.instanceId,
      alias: reservation.alias,
      instanceExisted: reservation.instanceExisted,
    });
    try {
      const bundle = yield* this.provisionSteps(
        input,
        naming,
        reservation,
        log,
      );
      log.info("provisioning complete", { friendId: reservation.friendId });
      yield { type: "done", result: bundle };
    } catch (err) {
      // Mark the friend failed so the cleanup sweep can reap it.
      await this.repo.markFailed(reservation.friendId);
      // Audit the failure BEFORE the reap below deletes the friend row — the
      // add runs in a detached job, so the tRPC middleware never sees this.
      await this.repo.audit(
        reservation.friendId,
        "action_failed",
        `add ${input.name}: ${String(err)}`,
      ).catch(() => {/* best-effort; never mask the original error */});
      // Best-effort container diagnostics so the failure log says WHY.
      const diag = await this.runtime
        .diagnoseInstance(reservation.tsHostname)
        .catch(() => null);
      log.error("provisioning failed", {
        friendId: reservation.friendId,
        error: String(err),
        instanceState: diag?.state,
        instanceHealth: diag?.health,
        healthReason: diag?.healthReason,
        podEvents: diag?.events,
      });
      if (diag?.recentLogs) {
        log.debug("instance logs", { logs: diag.recentLogs });
      }
      // Detach the reap — it can take minutes and the error must surface now;
      // if it can't finish, the row is already marked failed and the sweep
      // retries. It runs under the same mutex, so it can't race other ops.
      void this.mutex
        .run(() =>
          this.attempt(
            log,
            "inline reap after failure",
            () => this.reapFriend(reservation.friendId, log),
          )
        )
        .catch((reapErr) =>
          // attempt() already logs and swallows per-step failures; this fires
          // only if the detached chain itself rejects (e.g. the mutex task),
          // so nothing is silent.
          log.error("detached inline reap failed unexpectedly", {
            friendId: reservation.friendId,
            error: String(reapErr),
          })
        );
      throw err;
    }
  }

  rotateKey(friendId: number): Promise<FriendBundle> {
    return this.mutex.run(() => this.rotateKeyLocked(friendId));
  }

  private async rotateKeyLocked(friendId: number): Promise<FriendBundle> {
    const log = this.logger.child({ op: "rotateKey", friendId });
    log.info("rotating S3 key");
    const ctx = await this.repo.context(friendId);
    const mc = this.mc.forInstance({
      alias: ctx.alias,
      minioPort: ctx.minioPort,
    });
    const warnings: string[] = [];
    // Self-heal first: a previously failed rotation can have left a stale user
    // attached to the bucket policy that no DB row records.
    const swept = await this.removeStaleUsers(
      mc,
      ctx.bucket,
      ctx.s3AccessKeyId,
      log,
    );
    if (swept.length > 0) {
      warnings.push(
        `Removed ${swept.length} stale credential(s) left by a previously failed rotation.`,
      );
    }
    const cred = this.keyGen.generateS3Credential();
    log.debug("replacing S3 user", {
      bucket: ctx.bucket,
      newAccessKeyId: cred.accessKeyId,
      oldAccessKeyId: ctx.s3AccessKeyId,
    });
    // Create-before-remove: the friend is never credential-less and the DB never
    // records a key ID MinIO lacks; random IDs let old and new coexist briefly.
    await mc.createUser(cred);
    await mc.attachPolicy(cred.accessKeyId, ctx.bucket);
    await this.repo.recordAccessKey(friendId, cred.accessKeyId);
    if (ctx.s3AccessKeyId) {
      try {
        await mc.removeUser(ctx.s3AccessKeyId); // not-found-tolerant
      } catch (err) {
        // The new cred is live and recorded; the stale old user is swept by
        // the next rotate or by offboard (removeStaleUsers) — never lost.
        log.warn(
          "old credential removal failed; swept on next rotate/offboard",
          {
            oldAccessKeyId: ctx.s3AccessKeyId,
            error: String(err),
          },
        );
        warnings.push(
          "The old credential could not be removed and stays live until the " +
            "next rotate or offboard. The new credential is active.",
        );
      }
    }
    await this.repo.audit(friendId, "rotate_key");
    log.info("S3 key rotated");
    return this.buildRotateBundle(ctx, cred, warnings);
  }

  async reissueTsKey(friendId: number): Promise<TsKeyBundle> {
    const log = this.logger.child({ op: "reissueTsKey", friendId });
    log.info("re-issuing tailscale enrollment key");
    const ctx = await this.repo.context(friendId);
    if (ctx.enrollmentMode === "invite") {
      throw new ConflictError(
        "invite-enrolled friends join with their own account — there is no " +
          "auth key to re-issue.",
      );
    }
    const minted = await this.tailscale.mintAuthKey({ tag: ctx.nodeTag });
    await this.repo.recordTsKeyId(friendId, minted.keyId);
    // Mint before revoking so a failed mint never leaves the friend keyless;
    // an unused key stays valid ~90 days. Revocation is an auth_keys op, so it
    // works in manual ACL mode.
    if (ctx.tsKeyId) await this.tailscale.revokeAuthKey(ctx.tsKeyId);
    await this.repo.audit(friendId, "reissue_ts_key");
    log.info("tailscale key re-issued", { tag: ctx.nodeTag });
    return {
      name: ctx.name,
      tsAuthKey: minted.key,
      tailscaleUpCommand: `tailscale up --authkey=${minted.key}`,
    };
  }

  /** Pins tsHostname to the instance's current live hostname. */
  async acceptHostname(friendId: number): Promise<void> {
    const log = this.logger.child({ op: "acceptHostname", friendId });
    const ctx = await this.repo.context(friendId);
    const node = (await this.tailscale.nodesByTag(this.config.serveNodeTag))
      .find((n) => n.nodeId === ctx.serveNodeId);
    if (!node) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `instance ${ctx.tsHostname} has no serve node to accept`,
      );
    }
    await this.repo.recordConfirmedHostname(ctx.instanceId, node.hostname);
    await this.repo.audit(
      friendId,
      "instance_hostname_accepted",
      `${ctx.tsHostname} -> ${node.hostname}`,
    );
    log.info("accepted new hostname", {
      from: ctx.tsHostname,
      to: node.hostname,
    });
  }

  /** Restarts the instance to re-request its pinned hostname. Refuses if
   * an ONLINE device still holds it — a restart can't fix that. */
  async retryHostnameClaim(
    friendId: number,
  ): Promise<{ reclaimed: boolean; hostname: string }> {
    const log = this.logger.child({ op: "retryHostnameClaim", friendId });
    const ctx = await this.repo.context(friendId);
    const free = await this.reclaimHostnameIfOffline(ctx.tsHostname, log);
    if (!free) {
      return { reclaimed: false, hostname: ctx.tsHostname };
    }
    await this.runtime.stopInstance(ctx.tsHostname);
    await this.runtime.ensureRunning(ctx.tsHostname);
    await this.runtime.waitUntilHealthy(ctx.tsHostname);
    const confirmed = await this.confirmHostname(
      ctx.instanceId,
      ctx.tsHostname,
      log,
    );
    log.info("retried hostname claim", {
      requested: ctx.tsHostname,
      confirmed,
    });
    return { reclaimed: confirmed === ctx.tsHostname, hostname: confirmed };
  }

  async resendInvite(friendId: number): Promise<void> {
    const ctx = await this.repo.context(friendId);
    if (ctx.enrollmentMode !== "invite" || !ctx.inviteId) {
      throw new ConflictError("no pending Tailscale invite to resend");
    }
    if (!this.userInvite.configured) {
      throw new ServiceError(
        "PRECONDITION_FAILED",
        "No Tailscale API token configured — resend from the console.",
      );
    }
    await this.userInvite.resendUserInvite(ctx.inviteId);
    this.logger.info("resent user-invite", {
      friendId,
      email: ctx.inviteEmail,
    });
  }

  /** Acceptance is checked without the personal token; only the
   * pending-vs-expired split needs it, so without a token an un-joined friend
   * shows as `pending` or `manual`. */
  async inviteStatus(friendId: number): Promise<InviteStatusView> {
    const ctx = await this.repo.context(friendId);
    if (ctx.enrollmentMode !== "invite" || !ctx.inviteEmail) {
      throw new ConflictError("friend was not enrolled by invite");
    }
    const email = ctx.inviteEmail;
    if (await this.tailscale.hasJoined(email)) {
      await this.persistInviteStatus(friendId, email, ctx.inviteId, "accepted");
      return { status: "accepted", email };
    }
    if (this.userInvite.configured && ctx.inviteId) {
      const invite = await this.userInvite.getUserInvite(ctx.inviteId);
      const status: InviteStatus = invite ? "pending" : "expired";
      await this.persistInviteStatus(friendId, email, ctx.inviteId, status);
      return {
        status,
        email,
        inviteUrl: invite?.inviteUrl,
        emailedAt: invite?.lastEmailSentAt ?? undefined,
      };
    }
    const status: InviteStatus = ctx.inviteId ? "pending" : "manual";
    await this.persistInviteStatus(friendId, email, ctx.inviteId, status);
    return { status, email };
  }

  private persistInviteStatus(
    friendId: number,
    email: string,
    inviteId: string | null,
    status: InviteStatus,
  ): Promise<void> {
    return this.repo.recordInvite(friendId, { email, inviteId, status });
  }

  /** Re-issue config living OUTSIDE instance data (friend ACL grants) on each
   * boot reconcile. Idempotent — steady state is a cheap no-op. */
  realignInstance(instance: InstanceRef): Promise<void> {
    return this.mutex.run(() => this.reapplyFriendAcls(instance));
  }

  /** Recreate a missing container on top of its surviving data volume; buckets
   * and creds are untouched, only the tailnet identity is re-established.
   * Idempotent. */
  recoverInstance(instance: InstanceRef): Promise<void> {
    return this.mutex.run(() => this.recoverInstanceLocked(instance));
  }

  private async recoverInstanceLocked(instance: InstanceRef): Promise<void> {
    const log = this.logger.child({
      op: "recoverInstance",
      instance: instance.tsHostname,
    });
    log.info("container gone but data present — recreating over it");
    // Free the hostname first: a stale serve node still holding it would force
    // the re-enrolled instance onto a renamed hostname and break MagicDNS.
    await this.deleteServeNodes(instance.tsHostname, log);
    const serveKey = await this.mintServeKey();
    await this.runtime.ensureInstance(
      this.specForInstance(
        instance.tsHostname,
        instance.minioPort,
        serveKey.key,
      ),
    );
    await this.runtime.waitUntilHealthy(instance.tsHostname);
    // A fresh registration can still land on a collision suffix; everything
    // below must use the confirmed name, not the requested one.
    const current: InstanceRef = {
      ...instance,
      tsHostname: await this.confirmHostname(
        instance.instanceId,
        instance.tsHostname,
        log,
      ),
    };
    await this.reapplyFriendAcls(current);
    // System audit row (friendId null): the event is instance-level and may
    // span several pooled friends.
    await this.repo.audit(
      null,
      "instance_recovered",
      `${current.tsHostname} recreated over surviving data`,
    );
    if (this.config.aclMode === "manual") {
      log.warn(
        "manual ACL mode: instance re-enrolled — verify its grants still " +
          "point at the current endpoint",
      );
    }
    log.info("instance recreated over existing data");
  }

  /** Frees tsHostname unconditionally — only call when the caller already
   * has independent proof (e.g. container confirmed gone) that nothing is
   * really alive behind it; Tailscale's `online` flag lags too much to
   * trust for that call. */
  private async deleteServeNodes(
    tsHostname: string,
    log: Logger,
  ): Promise<void> {
    const stale = (await this.tailscale.nodesByTag(this.config.serveNodeTag))
      .filter((n) => n.hostname === tsHostname);
    await Promise.all(
      stale.map((n) =>
        this.tailscale.deleteNode(n.nodeId).catch((err) =>
          log.warn("stale serve node delete failed (continuing)", {
            nodeId: n.nodeId,
            error: String(err),
          })
        )
      ),
    );
  }

  /** Frees tsHostname from an OFFLINE serve node before requesting it — an
   * unfreed name gets silently suffixed. Unlike deleteServeNodes, never
   * touches an ONLINE holder. Returns whether the name ended up free. */
  private async reclaimHostnameIfOffline(
    tsHostname: string,
    log: Logger,
  ): Promise<boolean> {
    const holders = (await this.tailscale.nodesByTag(this.config.serveNodeTag))
      .filter((n) => n.hostname === tsHostname);
    const stale = holders.filter((n) => !n.online);
    const live = holders.filter((n) => n.online);
    if (live.length > 0) {
      log.error(
        "tsHostname is held by an ONLINE device — refusing to delete; " +
          "this instance may register under a suffixed hostname instead",
        { tsHostname, nodeIds: live.map((n) => n.nodeId) },
      );
    }
    await Promise.all(
      stale.map((n) =>
        this.tailscale.deleteNode(n.nodeId).catch((err) =>
          log.warn("stale serve node delete failed (continuing)", {
            nodeId: n.nodeId,
            error: String(err),
          })
        )
      ),
    );
    return live.length === 0;
  }

  /** Records the serve node's stable ID and repins tsHostname if Tailscale
   * granted a collision suffix instead of what was requested. Returns the
   * confirmed hostname. */
  private async confirmHostname(
    instanceId: number,
    requestedHostname: string,
    log: Logger,
  ): Promise<string> {
    const node = (await this.tailscale.nodesByTag(this.config.serveNodeTag))
      .find((n) =>
        n.hostname === requestedHostname ||
        n.hostname.startsWith(`${requestedHostname}-`)
      );
    if (!node) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `instance ${requestedHostname} has no serve node yet`,
      );
    }
    await this.repo.recordServeNodeId(instanceId, node.nodeId);
    if (node.hostname !== requestedHostname) {
      log.warn("tailscale granted a different hostname than requested", {
        requested: requestedHostname,
        actual: node.hostname,
      });
      await this.repo.recordConfirmedHostname(instanceId, node.hostname);
    }
    return node.hostname;
  }

  /** Ensure the serve tag is owned first (auto mode only) — it never appears as
   * an ACL src, so nothing else declares it in tagOwners. */
  private async mintServeKey() {
    if (this.config.aclMode !== "manual") {
      await this.tailscale.ensureTagOwner(this.config.serveNodeTag);
    }
    return this.tailscale.mintAuthKey({ tag: this.config.serveNodeTag });
  }

  /** Idempotent per grant; in manual mode the admin owns the policy, so skip.
   * Applies run sequentially because each call edits the whole tailnet policy
   * and concurrent edits would clobber each other. */
  private async reapplyFriendAcls(instance: InstanceRef): Promise<void> {
    if (this.config.aclMode === "manual") return;
    const tags = await this.repo.liveFriendTagsOnInstance(instance.instanceId);
    if (tags.length === 0) return;
    const ip = await this.tailscale.nodeIpv4(instance.tsHostname);
    if (!ip) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `instance ${instance.tsHostname} has no tailnet IP for ACL re-apply`,
      );
    }
    const endpointHostPort = `${ip}:${
      this.config.serveMode === "http" ? 80 : 443
    }`;
    await tags.reduce(
      (p, tag) =>
        p.then(() => this.tailscale.ensureFriendAcl(tag, endpointHostPort)),
      Promise.resolve(),
    );
  }

  offboard(friendId: number): Promise<OffboardResult> {
    return drainForResult(this.offboardStream(friendId));
  }

  offboardStream(
    friendId: number,
  ): AsyncGenerator<ProgressEvent<OffboardStepKey, OffboardResult>> {
    return this.mutex.runStream(() => this.offboardLocked(friendId));
  }

  private async *offboardLocked(
    friendId: number,
  ): AsyncGenerator<ProgressEvent<OffboardStepKey, OffboardResult>> {
    const log = this.logger.child({ op: "offboard", friendId });
    log.info("offboarding friend");
    const ctx = await this.repo.context(friendId);
    await this.guardComplianceLock(ctx);
    log.debug("tearing down friend resources", {
      bucket: ctx.bucket,
      nodeTag: ctx.nodeTag,
    });
    const manualUserRemoval = yield* this.tearDownSteps(ctx, log);
    yield { type: "step", step: "record" };
    // Audit BEFORE deleting the friend row — the audit FK points at friends.id.
    // The name is snapshot into the row (friendName), so it survives the delete.
    await this.repo.audit(friendId, "offboard", `mode=${ctx.isolationMode}`);
    await this.repo.deleteFriend(friendId);
    yield { type: "step", step: "reap" };
    await this.reapInstanceIfEmpty(ctx, log);
    log.info("offboard complete", { isolationMode: ctx.isolationMode });
    const result: OffboardResult = {};
    // Manual ACL mode: the manager never touched the policy, so tell the admin
    // which entries are now stale — advisory, the offboard is done.
    if (this.config.aclMode === "manual") {
      result.manualAclCleanup = manualAclRemovalInstructions(
        this.aclSrcFor(ctx),
      );
    }
    if (manualUserRemoval) result.manualUserRemoval = manualUserRemoval;
    yield { type: "done", result };
  }

  // ---- provisioning steps (add-friend flow) ----

  private async *provisionSteps(
    input: AddFriendInput,
    naming: FriendNaming,
    reservation: InstanceReservation,
    log: Logger,
  ): AsyncGenerator<StepEvent<ProvisionStepKey>, FriendBundle> {
    const mc = this.mc.forInstance({
      alias: reservation.alias,
      minioPort: reservation.hostPort,
    });
    const cred = this.keyGen.generateS3Credential();
    const aclSrc = input.enrollment.mode === "invite"
      ? input.enrollment.email
      : naming.nodeTag;
    log.info("step: ensure instance + ACL");
    // MUST precede minting the friend key: Tailscale rejects an auth key for a
    // tag that isn't yet declared in tagOwners, and ensureFriendAcl declares it.
    const { manualAcl, tsHostname } = yield* this.ensureInfraSteps(
      reservation,
      aclSrc,
      log,
    );
    // reservation.tsHostname may be stale (Tailscale can grant a collision
    // suffix); every step below must see the confirmed name instead.
    const confirmed: InstanceReservation = { ...reservation, tsHostname };
    yield { type: "step", step: "authkey" };
    const enroll = await this.enrollFriend(
      input,
      naming,
      confirmed.friendId,
      log,
    );
    log.info("step: create bucket + user", { bucket: naming.bucket });
    yield* this.createBucketAndUserSteps(
      mc,
      naming,
      cred,
      confirmed.friendId,
      log,
    );
    log.info("step: smoke-test + arm retention/quota");
    const auditWarning = yield* this.smokeAndArmSteps(
      mc,
      input,
      naming,
      confirmed,
      cred,
      log,
    );
    log.info("step: finalize (activate)");
    yield* this.finalizeSteps(confirmed, input, log);
    log.debug("rendering credentials bundle");
    return this.buildAddBundle(
      input,
      naming,
      confirmed,
      cred,
      enroll,
      manualAcl,
      auditWarning,
    );
  }

  private enrollFriend(
    input: AddFriendInput,
    naming: FriendNaming,
    friendId: number,
    log: Logger,
  ): Promise<EnrollmentResult> {
    if (input.enrollment.mode === "invite") {
      return this.enrollByInvite(friendId, input.enrollment.email, log);
    }
    return this.enrollByAuthKey(friendId, naming.nodeTag, log);
  }

  /** Mint the friend's single-use tagged key and store its id (never the
   * secret) so a failure reap or offboard can revoke it. */
  private async enrollByAuthKey(
    friendId: number,
    tag: string,
    log: Logger,
  ): Promise<EnrollmentResult> {
    log.debug("minting friend tailscale auth key", { tag });
    const friendKey = await this.tailscale.mintAuthKey({ tag });
    await this.repo.recordTsKeyId(friendId, friendKey.keyId);
    return { mode: "authKey", tsAuthKey: friendKey.key };
  }

  /** A missing or broken token never fails the add; it falls back to manual
   * invite instructions. */
  private async enrollByInvite(
    friendId: number,
    email: string,
    log: Logger,
  ): Promise<EnrollmentResult> {
    if (!this.userInvite.configured) {
      log.info("no personal API token — advising manual invite", { email });
      await this.repo.recordInvite(friendId, {
        email,
        inviteId: null,
        status: "manual",
      });
      return {
        mode: "invite",
        email,
        manualInstructions: manualInviteInstructions(email),
      };
    }
    try {
      const invite = await this.userInvite.createUserInvite(email);
      await this.repo.recordInvite(friendId, {
        email,
        inviteId: invite.id,
        status: "pending",
      });
      log.info("user-invite created", { email, inviteId: invite.id });
      return {
        mode: "invite",
        email,
        inviteUrl: invite.inviteUrl,
        inviteEmailedAt: invite.lastEmailSentAt ?? undefined,
      };
    } catch (err) {
      log.warn("invite creation failed — advising manual invite", {
        email,
        error: String(err),
      });
      await this.repo.recordInvite(friendId, {
        email,
        inviteId: null,
        status: "manual",
      });
      return {
        mode: "invite",
        email,
        manualInstructions: manualInviteInstructions(email),
        warning:
          "The Tailscale invite could not be sent automatically (check " +
          "P0RT1ON_TAILSCALE_API_TOKEN). Invite this friend from the console.",
      };
    }
  }

  /** In manual ACL mode the manager can't edit the policy, so this returns the
   * grant lines for the admin to paste. */
  private async *ensureInfraSteps(
    reservation: InstanceReservation,
    aclSrc: string,
    log: Logger,
  ): AsyncGenerator<
    StepEvent<ProvisionStepKey>,
    { manualAcl: string | undefined; tsHostname: string }
  > {
    yield { type: "step", step: "instance" };
    await this.ensurePair(reservation, log);
    yield { type: "step", step: "tailnet" };
    // Caller must use the returned value downstream, not reservation.tsHostname
    // — Tailscale can grant a collision suffix instead of what was requested.
    const tsHostname = await this.confirmHostname(
      reservation.instanceId,
      reservation.tsHostname,
      log,
    );
    // ACL dst must be an IP (Tailscale rejects a MagicDNS FQDN); the node has
    // joined by now (ensurePair waited for healthy), so its IP is assigned.
    const ip = await this.tailscale.nodeIpv4(tsHostname);
    if (!ip) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `instance ${tsHostname} has no tailnet IP yet`,
      );
    }
    const endpointHostPort = `${ip}:${
      this.config.serveMode === "http" ? 80 : 443
    }`;
    if (this.config.aclMode === "manual") {
      log.info("manual ACL mode — admin must add the grant by hand", {
        src: aclSrc,
      });
      // The admin owns their own tags when pasting into their policy.
      return {
        manualAcl: manualAclInstructions(
          aclSrc,
          endpointHostPort,
          "autogroup:admin",
        ),
        tsHostname,
      };
    }
    log.debug("applying friend ACL", {
      src: aclSrc,
      endpointHostPort,
    });
    await this.tailscale.ensureFriendAcl(aclSrc, endpointHostPort);
    return { manualAcl: undefined, tsHostname };
  }

  private async ensurePair(
    reservation: InstanceReservation,
    log: Logger,
  ): Promise<void> {
    if (reservation.instanceExisted) {
      // Adopting the shared pool: start if stopped and verify health, so a dead
      // pool fails THIS add cleanly instead of at some later mc call.
      log.debug("adopting existing instance; verifying health", {
        instanceId: reservation.instanceId,
        tsHostname: reservation.tsHostname,
      });
      await this.runtime.ensureRunning(reservation.tsHostname);
      await this.runtime.waitUntilHealthy(reservation.tsHostname);
      return;
    }
    // Free an offline squatter (e.g. a friend name reused after removal)
    // before requesting it — an unfreed hostname gets silently suffixed.
    await this.reclaimHostnameIfOffline(reservation.tsHostname, log);
    // The instance's own serve key (not the friend's) and the derived root
    // cred travel on the spec in memory only; the runtime picks the secret
    // transport (env-file or Secret).
    const serveKey = await this.mintServeKey();
    const spec = this.specFor(reservation, serveKey.key);
    log.debug("starting instance", {
      instance: spec.name,
      minioPort: spec.minioPort,
    });
    await this.runtime.ensureInstance(spec);
    // Starting an instance returns before MinIO is accepting connections;
    // wait for its healthcheck to pass before any admin (mc) call.
    log.debug("waiting for instance to become healthy", {
      tsHostname: reservation.tsHostname,
    });
    await this.runtime.waitUntilHealthy(reservation.tsHostname);
  }

  private async *createBucketAndUserSteps(
    mc: McClient,
    naming: FriendNaming,
    cred: S3Credential,
    friendId: number,
    log: Logger,
  ): AsyncGenerator<StepEvent<ProvisionStepKey>, void> {
    yield { type: "step", step: "bucket" };
    log.debug("making object-locked bucket", { bucket: naming.bucket });
    await mc.makeBucketWithLock(naming.bucket); // do NOT arm retention yet
    log.debug("creating S3 user + bucket policy", {
      accessKeyId: cred.accessKeyId, // ID only — never log the secret
    });
    await mc.createUser(cred);
    await mc.putBucketScopedPolicy(naming.bucket, naming.bucket);
    await mc.attachPolicy(cred.accessKeyId, naming.bucket);
    await this.repo.recordAccessKey(friendId, cred.accessKeyId); // ID only
  }

  /** Smoke-test the key BEFORE arming retention. */
  private async *smokeAndArmSteps(
    mc: McClient,
    input: AddFriendInput,
    naming: FriendNaming,
    reservation: InstanceReservation,
    cred: S3Credential,
    log: Logger,
  ): AsyncGenerator<StepEvent<ProvisionStepKey>, string | undefined> {
    yield { type: "step", step: "smoke" };
    // Smoke-test over the ADMIN endpoint (same MinIO) — the manager isn't on
    // the tailnet and can't reach the serve URL.
    const adminEndpoint = this.runtime.adminEndpoint(
      reservation.tsHostname,
      reservation.hostPort,
    );
    log.debug("running smoke test", {
      bucket: naming.bucket,
      endpoint: adminEndpoint,
    });
    await this.smokeTester.run({
      endpoint: adminEndpoint,
      bucket: naming.bucket,
      cred,
    });
    const auditWarning = await this.checkAuditDelivery(
      reservation.friendId,
      naming.bucket,
      log,
    );
    yield { type: "step", step: "retention" };
    log.debug("arming default retention", {
      bucket: naming.bucket,
      lockMode: input.lockMode,
      retentionDays: input.retentionDays,
    });
    await mc.setDefaultRetention(
      naming.bucket,
      input.lockMode,
      input.retentionDays,
    );
    log.debug("setting hard quota", {
      bucket: naming.bucket,
      quotaBytes: input.quotaBytes,
    });
    await mc.setHardQuota(naming.bucket, input.quotaBytes);
    return auditWarning;
  }

  /** The smoke test's traffic is the first thing MinIO audits, so a recorded
   * request proves the webhook reaches the manager. Reading also clears the
   * row: that traffic is provisioning's own and must not show as the friend's
   * usage. Never throws — a broken audit pipeline degrades a portion's stats,
   * it does not stop it backing up. */
  private async checkAuditDelivery(
    friendId: number,
    bucket: string,
    log: Logger,
  ): Promise<string | undefined> {
    const lastRequestAt = await this.readAuditActivity(friendId);
    if (lastRequestAt) {
      log.debug("audit delivery confirmed", { bucket });
      return undefined;
    }
    log.warn(
      "no audit event recorded for the smoke test — portion is degraded " +
        "(activity stats will stay empty; backups are unaffected)",
      { bucket, friendId },
    );
    return "Audit delivery could not be confirmed during provisioning — " +
      "activity stats may stay empty until the instance's audit webhook " +
      "reaches the manager. Backups are unaffected.";
  }

  /** Reads (and clears) the friend's activity, retrying briefly so a slow
   * webhook flush isn't mistaken for a broken one. Recursive rather than a
   * loop, matching `pollHealth`. Re-reading is
   * safe: takeActivity is read-then-delete, so a delete on an empty row is a
   * no-op and an event landing between attempts is caught by the next one. */
  private async readAuditActivity(
    friendId: number,
    attemptsLeft = AUDIT_READ_ATTEMPTS,
  ): Promise<string | null> {
    const { lastRequestAt } = await this.aggregator.takeActivity(friendId);
    if (lastRequestAt || attemptsLeft <= 1) return lastRequestAt;
    await new Promise((resolve) => setTimeout(resolve, AUDIT_READ_GAP_MS));
    return this.readAuditActivity(friendId, attemptsLeft - 1);
  }

  private async *finalizeSteps(
    reservation: InstanceReservation,
    input: AddFriendInput,
    log: Logger,
  ): AsyncGenerator<StepEvent<ProvisionStepKey>, void> {
    yield { type: "step", step: "finalize" };
    log.debug("activating friend", {
      friendId: reservation.friendId,
      instanceId: reservation.instanceId,
    });
    await this.repo.activate(reservation.friendId, reservation.instanceId);
    await this.repo.audit(
      reservation.friendId,
      "add_friend",
      `mode=${input.isolationMode}`,
    );
  }

  // ---- offboard helpers ----

  /** An absent container means the MinIO storage is already gone, so teardown
   * is vacuously done (mc would only wedge). Present-but-unreachable is not
   * the same: the data may survive, so mc still runs. */
  private async instanceGone(
    ctx: FriendProvisionContext,
    log: Logger,
  ): Promise<boolean> {
    const state = await this.runtime
      .diagnoseInstance(ctx.instanceName)
      .then((d) => d.state)
      .catch(() => null);
    if (state === "absent") {
      log.info(
        "instance absent — MinIO storage already gone, skipping teardown",
        { instance: ctx.instanceName },
      );
      return true;
    }
    return false;
  }

  /** Best-effort MinIO teardown: "already absent" is success. */
  private async reapStorage(
    ctx: FriendProvisionContext,
    mc: McClient,
    rlog: Logger,
  ): Promise<Record<string, boolean>> {
    if (await this.instanceGone(ctx, rlog)) {
      return { removeUser: true, removePolicy: true, removeBucket: true };
    }
    const ak = ctx.s3AccessKeyId;
    return {
      removeUser: await this.attempt(rlog, "removeUser", async () => {
        if (ak) await mc.removeUser(ak);
        // Stale users from a failed rotation die with the friend too.
        await this.removeStaleUsers(mc, ctx.bucket, null, rlog);
      }),
      removePolicy: await this.attempt(
        rlog,
        "removePolicy",
        () => mc.removePolicy(ctx.bucket),
      ),
      removeBucket: await this.attempt(
        rlog,
        "removeBucket",
        () => mc.removeBucket(ctx.bucket),
      ),
    };
  }

  /** Returns the manual user-removal advisory, or undefined when none is
   * needed. */
  private async *tearDownSteps(
    ctx: FriendProvisionContext,
    log: Logger,
  ): AsyncGenerator<StepEvent<OffboardStepKey>, string | undefined> {
    const mc = this.mc.forInstance({
      alias: ctx.alias,
      minioPort: ctx.minioPort,
    });
    yield { type: "step", step: "storage" };
    if (!(await this.instanceGone(ctx, log))) {
      if (ctx.s3AccessKeyId) await mc.removeUser(ctx.s3AccessKeyId);
      // Also sweep users a failed rotation may have left attached to the
      // policy — no credential may outlive the friend.
      await this.removeStaleUsers(mc, ctx.bucket, null, log);
      // The bucket-scoped IAM policy (named after the bucket) would otherwise
      // live in MinIO forever; absent is success.
      await mc.removePolicy(ctx.bucket);
      await mc.removeBucket(ctx.bucket); // force; deletes all versions
    }
    yield { type: "step", step: "nodes" };
    const manualUserRemoval = await this.tearDownEnrollment(ctx, log);
    yield { type: "step", step: "acl" };
    await this.removeAclOrAdvise(this.aclSrcFor(ctx), log);
    return manualUserRemoval;
  }

  private async tearDownEnrollment(
    ctx: FriendProvisionContext,
    log: Logger,
  ): Promise<string | undefined> {
    if (ctx.enrollmentMode !== "invite") {
      await this.revokeFriendNodes(ctx.nodeTag);
      // An unused key stays live ~90 days; a missing id or an already-revoked
      // key is fine.
      if (ctx.tsKeyId) await this.tailscale.revokeAuthKey(ctx.tsKeyId);
      return undefined;
    }
    if (!ctx.inviteEmail) return undefined;
    if (!this.userInvite.configured) {
      log.info("no personal API token — advising manual user removal", {
        email: ctx.inviteEmail,
      });
      return manualUserRemovalInstructions(ctx.inviteEmail);
    }
    // Kill a still-pending invite so a re-add doesn't collide / double-send.
    if (ctx.inviteId) await this.userInvite.deleteUserInvite(ctx.inviteId);
    return await this.deleteInvitedUserOrAdvise(ctx, ctx.inviteEmail, log);
  }

  /** Delete ONLY when unambiguously safe: no other portion shares the email and
   * it's a plain member — deleting an owner/admin could lock out the tailnet. */
  private async deleteInvitedUserOrAdvise(
    ctx: FriendProvisionContext,
    email: string,
    log: Logger,
  ): Promise<string | undefined> {
    const shared = await this.repo.otherFriendsWithInviteEmail(
      ctx.friendId,
      email,
    );
    if (shared > 0) {
      log.info("another portion shares this tailnet user — leaving it", {
        email,
      });
      return manualUserRemovalInstructions(email);
    }
    const user = await this.userInvite.findUserByEmail(email);
    if (!user) return undefined; // never joined (pending/expired) — nothing to do
    if (user.role !== "member") {
      log.warn("tailnet user is not a plain member — not deleting", {
        email,
        role: user.role,
      });
      return manualUserRemovalInstructions(email);
    }
    await this.userInvite.deleteUser(user.id);
    log.info("deleted joined tailnet user", { email });
    return undefined;
  }

  private aclSrcFor(ctx: FriendProvisionContext): string {
    return ctx.enrollmentMode === "invite" && ctx.inviteEmail
      ? ctx.inviteEmail
      : ctx.nodeTag;
  }

  /** Manual ACL mode skips: the token can't edit the policy and the call would
   * 403 AFTER the user/bucket are gone, wedging the friend row. */
  private async removeAclOrAdvise(src: string, log: Logger): Promise<void> {
    if (this.config.aclMode === "manual") {
      log.info("manual ACL mode — admin should remove the policy entries", {
        src,
      });
      return;
    }
    await this.tailscale.removeFriendAcl(src);
  }

  /** Revoke a recorded pending invite so a retried add doesn't double-send; a
   * 404 is fine. */
  private async revokeDanglingInvite(
    ctx: FriendProvisionContext,
  ): Promise<void> {
    if (ctx.enrollmentMode !== "invite" || !ctx.inviteId) return;
    if (!this.userInvite.configured) return;
    await this.userInvite.deleteUserInvite(ctx.inviteId);
  }

  private async revokeFriendNodes(tag: string): Promise<void> {
    const nodes = await this.tailscale.nodesByTag(tag);
    await Promise.all(
      nodes.map((node) => this.tailscale.deleteNode(node.nodeId)),
    );
  }

  private async reapInstanceIfEmpty(
    ctx: FriendProvisionContext,
    log: Logger,
  ): Promise<void> {
    // Counts and marks in one transaction; false means friends remain (or a
    // concurrent add just reserved onto the pool), so leave the instance alone.
    const marked = await this.repo.markInstanceReaping(ctx.instanceId, {
      requireEmpty: ctx.isolationMode !== "dedicated",
    });
    if (!marked) {
      log.debug("instance still has friends; not reaping", {
        instanceId: ctx.instanceId,
      });
      return;
    }
    log.info("reaping instance", {
      instanceId: ctx.instanceId,
      instanceName: ctx.instanceName,
    });
    await this.runtime.removeInstance(ctx.instanceName, {
      removeData: true,
    });
    await this.attempt(
      log,
      "revoke serve node",
      () => this.revokeServeNode(ctx.serveNodeId, ctx.tsHostname),
    );
    await this.repo.deleteInstance(ctx.instanceId);
  }

  // ---- cleanup sweep (reap failed-provision tombstones) ----

  /** Logs and swallows — teardown is best-effort. Returns whether the step
   * succeeded so callers can gate tombstone deletion on it (never delete a row
   * whose resource may still exist). */
  private async attempt(
    log: Logger,
    step: string,
    fn: () => Promise<void>,
  ): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (err) {
      log.warn(`reap: ${step} failed (will retry next sweep)`, {
        error: String(err),
      });
      return false;
    }
  }

  /** Matches by stored ID (stable across control-plane renames), falling back
   * to hostname for pre-column instances. An absent node is already gone,
   * which is success. */
  private async revokeServeNode(
    serveNodeId: string | null,
    tsHostname: string,
  ): Promise<void> {
    const nodes = await this.tailscale.nodesByTag(this.config.serveNodeTag);
    const target = serveNodeId
      ? nodes.find((n) => n.nodeId === serveNodeId)
      : nodes.find((n) => n.hostname === tsHostname);
    if (target) await this.tailscale.deleteNode(target.nodeId);
  }

  private async reapFriend(friendId: number, log: Logger): Promise<void> {
    const ctx = await this.repo.context(friendId).catch(() => null);
    if (!ctx) return; // already reaped
    const rlog = log.child({ reapFriendId: friendId, name: ctx.name });
    // COMPLIANCE data is untouchable until retention lapses — skip the whole
    // reap (keep the tombstone) rather than half-tear around an undeletable bucket.
    const locked = await this.guardComplianceLock(ctx).then(() => false)
      .catch((err) => {
        rlog.warn("reap skipped: COMPLIANCE retention", {
          error: String(err),
        });
        return true;
      });
    if (locked) return;
    rlog.info("reaping failed friend");
    const mc = this.mc.forInstance({
      alias: ctx.alias,
      minioPort: ctx.minioPort,
    });
    const results: Record<string, boolean> = {
      ...(await this.reapStorage(ctx, mc, rlog)),
      removeAcl: await this.attempt(
        rlog,
        "removeAcl",
        () => this.removeAclOrAdvise(this.aclSrcFor(ctx), rlog),
      ),
      revokeNodes: await this.attempt(
        rlog,
        "revokeNodes",
        () => this.revokeFriendNodes(ctx.nodeTag),
      ),
      revokeAuthKey: await this.attempt(rlog, "revokeAuthKey", async () => {
        if (ctx.tsKeyId) await this.tailscale.revokeAuthKey(ctx.tsKeyId);
      }),
      revokeInvite: await this.attempt(
        rlog,
        "revokeInvite",
        () => this.revokeDanglingInvite(ctx),
      ),
    };
    const pending = Object.keys(results).filter((k) => !results[k]);
    if (pending.length > 0) {
      // The row is the only record these resources exist — deleting it now
      // would orphan them forever. Keep the tombstone; the next sweep retries.
      rlog.warn("reap incomplete; keeping tombstone for next sweep", {
        pending,
      });
      return;
    }
    await this.attempt(
      rlog,
      "deleteFriend",
      () => this.repo.deleteFriend(friendId),
    );
    await this.attempt(
      rlog,
      "reapInstance",
      () => this.reapInstanceIfEmpty(ctx, rlog),
    );
  }

  private async reapOrphanInstance(
    instanceId: number,
    tsHostname: string,
    serveNodeId: string | null,
    log: Logger,
  ): Promise<void> {
    const removed = await this.attempt(
      log,
      "removeInstance",
      () => this.runtime.removeInstance(tsHostname, { removeData: true }),
    );
    const revoked = await this.attempt(
      log,
      "revokeServeNode",
      () => this.revokeServeNode(serveNodeId, tsHostname),
    );
    if (!removed || !revoked) {
      // Same gating as reapFriend: the row is the record — keep it so the
      // next sweep retries the container/node teardown.
      log.warn("orphan instance reap incomplete; keeping row for next sweep", {
        instanceId,
        tsHostname,
      });
      return;
    }
    await this.attempt(
      log,
      "deleteInstance",
      () => this.repo.deleteInstance(instanceId),
    );
  }

  /** Any row still `provisioning` at process start is a crashed provision —
   * fail it so the same boot's sweep (main.ts) reaps it and frees the name/port. */
  async recoverStaleProvisioning(): Promise<string[]> {
    const names = await this.repo.failStaleProvisioning();
    if (names.length > 0) {
      this.logger.info("recovered stale provisioning rows", {
        count: names.length,
        names,
      });
    }
    return names;
  }

  sweepFailed(): Promise<number> {
    return this.mutex.run(() => this.sweepFailedLocked());
  }

  private async sweepFailedLocked(): Promise<number> {
    const log = this.logger.child({ op: "sweepFailed" });
    const friendIds = await this.repo.failedFriendIds();
    // Reaps run sequentially — each one frees its instance before the next
    // starts.
    await friendIds.reduce(
      (p, id) => p.then(() => this.reapFriend(id, log)),
      Promise.resolve(),
    );
    const orphans = await this.repo.failedInstances();
    await orphans.reduce(
      (p, o) =>
        p.then(() =>
          this.reapOrphanInstance(
            o.instanceId,
            o.tsHostname,
            o.serveNodeId,
            log,
          )
        ),
      Promise.resolve(),
    );
    const total = friendIds.length + orphans.length;
    if (total > 0) {
      log.info("cleanup sweep reaped tombstones", {
        friends: friendIds.length,
        orphanInstances: orphans.length,
      });
    }
    return total;
  }

  /** COMPLIANCE locks block deletion for everyone (root included), so refuse
   * before any destructive step. An empty bucket or a failed usage check
   * proceeds. */
  private async guardComplianceLock(
    ctx: FriendProvisionContext,
  ): Promise<void> {
    if (ctx.lockMode !== "COMPLIANCE") return;
    const mc = this.mc.forInstance({
      alias: ctx.alias,
      minioPort: ctx.minioPort,
    });
    const usage = await mc.du(ctx.bucket).catch(() => null);
    if (!usage || usage.objectCount === 0) return;
    const earliest = new Date(
      Date.now() + ctx.lockRetentionDays * 24 * 60 * 60 * 1000,
    );
    throw new ConflictError(
      `${ctx.name}'s bucket holds ${usage.objectCount} object(s) under ` +
        `COMPLIANCE retention — nothing can delete them until retention ` +
        `lapses. Offboard will be possible by ${
          earliest.toISOString().slice(0, 10)
        } at the latest.`,
    );
  }

  /** MinIO is the source of truth for a friend's users: a failed rotation can
   * leave a live user no DB row records — this sweep is how it converges. */
  private async removeStaleUsers(
    mc: McClient,
    policyName: string,
    keep: string | null,
    log: Logger,
  ): Promise<string[]> {
    const users = await mc.listUsers();
    const stale = users.filter((u) =>
      u.policies.includes(policyName) && u.accessKeyId !== keep
    );
    if (stale.length === 0) return [];
    log.warn("removing stale credentials attached to bucket policy", {
      policyName,
      accessKeyIds: stale.map((u) => u.accessKeyId),
    });
    await stale.reduce(
      (p, u) => p.then(() => mc.removeUser(u.accessKeyId)),
      Promise.resolve(),
    );
    return stale.map((u) => u.accessKeyId);
  }

  // ---- pure derivations (no I/O) ----

  private buildNaming(
    name: string,
    isolationMode: IsolationMode,
  ): FriendNaming {
    return {
      bucket: name,
      nodeTag: `tag:p0rt1on-friend-${name}`,
      tsHostname: isolationMode === "shared"
        ? `p0rt1on-${this.config.sharedInstanceName}`
        : `p0rt1on-${name}`,
    };
  }

  private endpointFor(tsHostname: string): Promise<string> {
    return serveEndpoint(this.tailscale, this.config.serveMode, tsHostname);
  }

  private specFor(
    reservation: InstanceReservation,
    tsAuthKey: string,
  ): InstanceSpec {
    return this.specForInstance(
      reservation.tsHostname,
      reservation.hostPort,
      tsAuthKey,
    );
  }

  private specForInstance(
    tsHostname: string,
    minioPort: number,
    tsAuthKey: string,
  ): InstanceSpec {
    return {
      name: tsHostname,
      image: this.config.instanceImage,
      tag: this.config.serveNodeTag,
      minioPort,
      rootCred: this.keyGen.rootCredentialFor(tsHostname),
      tsAuthKey,
      auditWebhook: {
        endpoint: this.config.auditWebhookUrl,
        authToken: this.config.auditWebhookToken,
      },
    };
  }

  private async buildAddBundle(
    input: AddFriendInput,
    naming: FriendNaming,
    reservation: InstanceReservation,
    cred: S3Credential,
    enroll: EnrollmentResult,
    manualAclInstructions?: string,
    auditWarning?: string,
  ): Promise<FriendBundle> {
    const endpoint = await this.endpointFor(reservation.tsHostname);
    const base: FriendBundle = {
      name: input.name,
      s3Endpoint: endpoint,
      bucket: naming.bucket,
      s3AccessKeyId: cred.accessKeyId,
      s3SecretKey: cred.secretKey,
      enrollmentMode: enroll.mode,
      manualAclInstructions,
      kopiaQuickstart: buildKopiaQuickstart({
        endpoint,
        bucket: naming.bucket,
        cred,
        retentionDays: input.retentionDays,
        create: true,
        joinLines: enroll.mode === "authKey"
          ? kopiaJoinLines(`tailscale up --authkey=${enroll.tsAuthKey}`)
          : kopiaInviteJoinLines(),
      }),
    };
    // Audit degradation isn't enrollment-specific, so it applies to both.
    const warnings = [
      enroll.mode === "invite" ? enroll.warning : undefined,
      auditWarning,
    ]
      .filter((w): w is string => w !== undefined);
    if (enroll.mode === "authKey") {
      return {
        ...base,
        tsAuthKey: enroll.tsAuthKey,
        tailscaleUpCommand: `tailscale up --authkey=${enroll.tsAuthKey}`,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
    return {
      ...base,
      inviteEmail: enroll.email,
      inviteUrl: enroll.inviteUrl,
      inviteEmailedAt: enroll.inviteEmailedAt,
      manualInviteInstructions: enroll.manualInstructions,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  private async buildRotateBundle(
    ctx: FriendProvisionContext,
    cred: S3Credential,
    warnings: string[],
  ): Promise<FriendBundle> {
    const endpoint = await this.endpointFor(ctx.tsHostname);
    return {
      warnings: warnings.length > 0 ? warnings : undefined,
      name: ctx.name,
      s3Endpoint: endpoint,
      bucket: ctx.bucket,
      s3AccessKeyId: cred.accessKeyId,
      s3SecretKey: cred.secretKey,
      // tsAuthKey / tailscaleUpCommand are omitted — the node is already
      // enrolled, and the existing repo makes the quickstart a `connect` with
      // the rotated key.
      kopiaQuickstart: buildKopiaQuickstart({
        endpoint,
        bucket: ctx.bucket,
        cred,
        retentionDays: ctx.lockRetentionDays,
        create: false,
      }),
    };
  }
}
