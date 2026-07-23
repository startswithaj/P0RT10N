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
import type { ProvisioningService as ProvisioningServiceContract } from "../services/types.ts";
import type { Logger } from "../services/types.ts";
import type { McClient, McClientFactory, S3Credential } from "../minio/mc.ts";
import type { InstanceRuntime, InstanceSpec } from "../runtime/runtime.ts";
import type { TailscaleApi } from "../tailscale/tailscale.ts";
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

/** The instance fields boot recovery/realign need — a `liveInstances` row. */
type InstanceRef = {
  instanceId: number;
  tsHostname: string;
  minioPort: number;
};

/**
 * How a friend joined the tailnet, resolved during the `authkey` step. authKey
 * carries the one-shot key secret; invite carries the acceptance link (or the
 * manual-console fallback when no token was configured / the create failed).
 */
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

/** Kopia quickstart join for an auth-key friend: redeem the single-use key. */
function kopiaJoinLines(tailscaleUpCommand: string): string[] {
  return [
    "# Join the tailnet (redeems your single-use key):",
    tailscaleUpCommand,
    "",
  ];
}

/** Kopia quickstart join for an invited friend: they generate their OWN auth
 * key (in their Tailscale account, after accepting) and join with it. */
function kopiaInviteJoinLines(): string[] {
  return [
    "# After accepting the invite, generate an auth key in your Tailscale admin",
    "# console (https://login.tailscale.com/admin/settings/keys), then join:",
    "tailscale up --authkey=<your-tailscale-auth-key>",
    "",
  ];
}

/** Kopia quickstart: the retention flags + snapshot step (create flow only). */
function kopiaCreateTail(retentionDays: number): string[] {
  return [
    `  --retention-mode=GOVERNANCE --retention-period=${retentionDays}d`,
    "",
    "# Then back up a directory (immutable for the retention window):",
    "kopia snapshot create /path/to/your/data",
  ];
}

/**
 * The "Add friend" state machine plus its destructive siblings. Pure
 * orchestration over injected deps — each PLAN provisioning step is one small
 * helper, sequenced by `provision`. On any failure the friend row is flipped to
 * `failed` (recoverable by the cleanup sweep) and the error is rethrown.
 */
export class ProvisioningService implements ProvisioningServiceContract {
  // Serializes the mutating ops (add/offboard/rotate/sweep) — intentional for
  // a single-admin app: it closes interleavings like reap-vs-add without
  // distributed locking. Read-only queries never touch it.
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
    private readonly logger: Logger,
  ) {}

  /** Non-streaming provision: drains the stream and hands back the bundle. */
  addFriend(input: AddFriendInput): Promise<FriendBundle> {
    return drainForResult(this.addFriendStream(input));
  }

  /**
   * Provision a friend, yielding a `step` event as each step begins and a final
   * `done` event carrying the once-shown bundle. A throw between steps propagates
   * straight out (the subscription errors on that step), so the UI halts on the
   * exact failing step instead of a fake timer running past it. Steps are named
   * by key (see PROVISION_STEPS); order can change without mislabelling.
   */
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
      // yield* forwards the step events AND returns provisionSteps' bundle.
      const bundle = yield* this.provisionSteps(
        input,
        naming,
        reservation,
        log,
      );
      log.info("provisioning complete", { friendId: reservation.friendId });
      yield { type: "done", result: bundle };
    } catch (err) {
      // Mark recoverable-failed for the cleanup sweep, then rethrow unchanged.
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
      });
      if (diag?.recentLogs) {
        log.debug("instance logs", { logs: diag.recentLogs });
      }
      // Immediately reap the partial resources; markFailed above is the fallback
      // for the periodic sweep if this best-effort reap can't finish.
      await this.attempt(
        log,
        "inline reap after failure",
        () => this.reapFriend(reservation.friendId, log),
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
    // Create-before-remove: the friend must never be credential-less, and the
    // DB must never record a key ID MinIO doesn't have. Key IDs are random,
    // so old and new coexist during the overlap. The bucket-scoped policy
    // already exists — just attach it to the new user.
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
    // No tsAuthKey: the node is already enrolled (see FriendBundle docs).
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
    // Mint-then-revoke: the friend is never left keyless if the mint fails.
    // The old key must not stay live once superseded (unused = still valid
    // for ~90 days). Revocation is an auth_keys API op, so it runs in manual
    // ACL mode too.
    if (ctx.tsKeyId) await this.tailscale.revokeAuthKey(ctx.tsKeyId);
    await this.repo.audit(friendId, "reissue_ts_key");
    log.info("tailscale key re-issued", { tag: ctx.nodeTag });
    return {
      name: ctx.name,
      tsAuthKey: minted.key,
      tailscaleUpCommand: `tailscale up --authkey=${minted.key}`,
    };
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

  /**
   * Reconcile an invited friend's status and persist it. Acceptance is read
   * WITHOUT the personal token — `tailscale.hasJoined` uses the users list
   * (with a `users:read` scope) or falls back to devices. Only the finer
   * pending-vs-expired split needs the personal token (it inspects the invite
   * itself); without it an un-joined friend reads `pending` (invite sent) or
   * `manual` (admin invited by hand).
   */
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
    // Not joined yet. With the personal token we can tell pending from expired
    // by inspecting the invite; otherwise report the outstanding state.
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

  /**
   * Re-issue the config a running instance must carry but that lives OUTSIDE
   * its data: the audit webhook (derived token) and every live friend's ACL
   * grant. Run on each boot reconcile of a present/recovered instance so the
   * webhook + tailnet policy converge on intent. Every step is idempotent, so
   * re-running on a steady-state instance is a cheap no-op.
   */
  realignInstance(instance: InstanceRef): Promise<void> {
    return this.mutex.run(() => this.realignInstanceLocked(instance));
  }

  private async realignInstanceLocked(instance: InstanceRef): Promise<void> {
    // The audit token is derived from the master key, so re-issuing it is what
    // lets a manager rebuild (new token) reconnect the instance with no manual
    // step. Idempotent.
    await this.mc.forInstance({
      alias: instance.tsHostname,
      minioPort: instance.minioPort,
    }).setAuditWebhook(
      this.config.auditWebhookUrl,
      this.config.auditWebhookToken,
    );
    await this.reapplyFriendAcls(instance);
  }

  /**
   * Recreate an instance the DB knows about but whose container/pod is gone,
   * over its EXISTING pantry data (the caller gates on data presence). The
   * friend's buckets, IAM users and creds live in that data and are untouched;
   * only the tailnet node identity is re-established. Idempotent: a partial
   * failure re-runs next boot — once the container is present again its ACLs +
   * webhook converge via the normal realign path.
   */
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
    const serveKey = await this.tailscale.mintAuthKey({
      tag: this.config.serveNodeTag,
    });
    await this.runtime.ensureInstance(
      this.specForInstance(
        instance.tsHostname,
        instance.minioPort,
        serveKey.key,
      ),
    );
    await this.runtime.waitUntilHealthy(instance.tsHostname);
    // Record the freshly-enrolled serve node's stable ID (offboard deletes by it).
    const serveNode =
      (await this.tailscale.nodesByTag(this.config.serveNodeTag))
        .find((n) => n.hostname === instance.tsHostname);
    if (serveNode) {
      await this.repo.recordServeNodeId(instance.instanceId, serveNode.nodeId);
    }
    // Webhook + ACLs — the same path a healthy instance realigns through.
    await this.realignInstanceLocked(instance);
    // System audit row (friendId null): the event is instance-level and may
    // span several pooled friends; the detail names the instance.
    await this.repo.audit(
      null,
      "instance_recovered",
      `${instance.tsHostname} recreated over surviving data`,
    );
    if (this.config.aclMode === "manual") {
      log.warn(
        "manual ACL mode: instance re-enrolled — verify its grants still " +
          "point at the current endpoint",
      );
    }
    log.info("instance recreated over existing data");
  }

  /** Delete every serve node currently holding this hostname (best-effort). */
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

  /**
   * Re-apply the ACL grant for every non-failed friend on the instance. In auto
   * mode `ensureFriendAcl` is a no-op when the grant is already present, so this
   * is cheap on a steady-state reconcile. Manual mode is admin-owned — skip it
   * silently here (recover logs a one-off reminder). Sequential: each call
   * edits the whole tailnet policy, so concurrent applies would clobber it.
   */
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

  /** Non-streaming offboard: drains the teardown stream to completion. */
  offboard(friendId: number): Promise<OffboardResult> {
    return drainForResult(this.offboardStream(friendId));
  }

  /**
   * Tear a friend down, yielding a `step` event as each step begins and a final
   * `done` event. A throw propagates out, so the UI halts on the failing step.
   * Steps are named by key (see OFFBOARD_STEPS).
   */
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
    // Record the offboard BEFORE deleting the friend row: the audit FK points at
    // friends.id, so inserting after the delete trips a FOREIGN KEY constraint.
    // The name is snapshot into the audit row (friendName), so it survives the
    // delete without stuffing it into `detail`.
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

  // ---- provisioning steps (PLAN "Add friend" flow) ----

  // Each helper yields its own step events (see PROVISION_STEPS) and, via yield*,
  // returns its result to the caller. Keys are explicit, so the order can change
  // without mislabelling. buildAddBundle is the generator's return value (picked
  // up by addFriendStream's `yield*`), not a yielded event.
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
    // The ACL grant subject differs by enrollment: an auth-key friend's node
    // tag, or an invited friend's own login email (identity-src grant).
    const aclSrc = input.enrollment.mode === "invite"
      ? input.enrollment.email
      : naming.nodeTag;
    log.info("step: ensure instance + ACL");
    // MUST precede minting the friend key: Tailscale rejects an auth key for a
    // tag that isn't yet declared in tagOwners, and ensureFriendAcl declares it.
    // In manual ACL mode this returns the grant lines the admin must paste.
    const manualAcl = yield* this.ensureInfraSteps(reservation, aclSrc, log);
    yield { type: "step", step: "authkey" };
    const enroll = await this.enrollFriend(
      input,
      naming,
      reservation.friendId,
      log,
    );
    log.info("step: create bucket + user", { bucket: naming.bucket });
    yield* this.createBucketAndUserSteps(
      mc,
      naming,
      cred,
      reservation.friendId,
      log,
    );
    log.info("step: smoke-test + arm retention/quota");
    yield* this.smokeAndArmSteps(mc, input, naming, reservation, cred, log);
    log.info("step: finalize (audit webhook + activate)");
    yield* this.finalizeSteps(mc, reservation, input, log);
    log.debug("rendering credentials bundle");
    return this.buildAddBundle(
      input,
      naming,
      reservation,
      cred,
      enroll,
      manualAcl,
    );
  }

  /** Dispatch enrollment by mode: invite (create-or-advise) or authKey (mint). */
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

  /** authKey enrollment: mint the friend's single-use tagged key; store its id
   * (never the secret) so failure-reap/offboard can revoke it. */
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

  /** invite enrollment: create a real user-invite when a personal token is
   * configured (Tailscale emails the friend); otherwise — or if the create
   * fails (expired/insufficient token) — record `manual` and advise the admin
   * to invite from the console. Never fails the provision on a token problem. */
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

  /**
   * Ensure the instance is up (skip if the shared pool already runs), then ACL
   * the friend. In `manual` mode the manager can't edit the policy file, so it
   * skips the API call and returns the grant lines for the admin to paste.
   */
  private async *ensureInfraSteps(
    reservation: InstanceReservation,
    aclSrc: string,
    log: Logger,
  ): AsyncGenerator<StepEvent<ProvisionStepKey>, string | undefined> {
    yield { type: "step", step: "instance" };
    await this.ensurePair(reservation, log);
    yield { type: "step", step: "tailnet" };
    // ACL dst must be an IP (Tailscale rejects a MagicDNS FQDN); the node has
    // joined by now (ensurePair waited for healthy), so its IP is assigned.
    const ip = await this.tailscale.nodeIpv4(reservation.tsHostname);
    if (!ip) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `instance ${reservation.tsHostname} has no tailnet IP yet`,
      );
    }
    // Capture the serve node's stable ID now, while it's freshly enrolled and
    // its hostname is unambiguous — offboard deletes by ID, not hostname.
    const serveNode =
      (await this.tailscale.nodesByTag(this.config.serveNodeTag))
        .find((n) => n.hostname === reservation.tsHostname);
    if (serveNode) {
      await this.repo.recordServeNodeId(
        reservation.instanceId,
        serveNode.nodeId,
      );
    }
    // Port follows the serve mode: 443 (https certs) or 80 (http — headscale).
    const endpointHostPort = `${ip}:${
      this.config.serveMode === "http" ? 80 : 443
    }`;
    if (this.config.aclMode === "manual") {
      log.info("manual ACL mode — admin must add the grant by hand", {
        src: aclSrc,
      });
      // The admin owns their own tags when pasting into their policy.
      return manualAclInstructions(aclSrc, endpointHostPort, "autogroup:admin");
    }
    log.debug("applying friend ACL", {
      src: aclSrc,
      endpointHostPort,
    });
    await this.tailscale.ensureFriendAcl(aclSrc, endpointHostPort);
    return undefined;
  }

  private async ensurePair(
    reservation: InstanceReservation,
    log: Logger,
  ): Promise<void> {
    if (reservation.instanceExisted) {
      // Adopting the shared pool: never assume it works — start it if it's
      // stopped and verify the HEALTHCHECK, so a dead pool fails THIS add
      // cleanly instead of at some later mc call (no silent adopt).
      log.debug("adopting existing instance; verifying health", {
        instanceId: reservation.instanceId,
        tsHostname: reservation.tsHostname,
      });
      await this.runtime.ensureRunning(reservation.tsHostname);
      await this.runtime.waitUntilHealthy(reservation.tsHostname);
      return;
    }
    // The instance needs its OWN serve auth key (server-side tag), separate
    // from the friend's enrollment key. It and the derived root cred ride the
    // spec IN MEMORY — the runtime picks the secret transport (docker: temp
    // env-file; k8s: Secret). Admin access needs no further setup: every mc
    // call derives the same root cred and carries it in its own MC_HOST env
    // var.
    const serveKey = await this.tailscale.mintAuthKey({
      tag: this.config.serveNodeTag,
    });
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

  /** Smoke-test the key BEFORE arming retention, then set retention + quota. */
  private async *smokeAndArmSteps(
    mc: McClient,
    input: AddFriendInput,
    naming: FriendNaming,
    reservation: InstanceReservation,
    cred: S3Credential,
    log: Logger,
  ): AsyncGenerator<StepEvent<ProvisionStepKey>, void> {
    yield { type: "step", step: "smoke" };
    // Smoke-test over the ADMIN endpoint (same MinIO), not the Tailscale URL —
    // the manager isn't on the tailnet and can't reach `<host>.<tailnet>:443`.
    // Only the runtime knows how to address an instance.
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
  }

  private async *finalizeSteps(
    mc: McClient,
    reservation: InstanceReservation,
    input: AddFriendInput,
    log: Logger,
  ): AsyncGenerator<StepEvent<ProvisionStepKey>, void> {
    yield { type: "step", step: "finalize" };
    log.debug("configuring audit webhook");
    // Idempotent per instance; the shared pool already has it.
    await mc.setAuditWebhook(
      this.config.auditWebhookUrl,
      this.config.auditWebhookToken,
    );
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

  /**
   * True when the instance container is ABSENT — its MinIO, and with it every
   * bucket/user/policy, is already gone. Storage teardown is then vacuously
   * done; reaching in with `mc` would only wedge on connection-refused (the
   * failure that used to strand an offboard whose instance had already been
   * removed). A present-but-unreachable instance is NOT treated this way — we
   * can't prove its data is gone, so the mc call still runs and surfaces the
   * real error rather than silently leaking a shared instance's resources.
   */
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

  /**
   * Best-effort MinIO teardown for the reap sweep — each step treats "already
   * absent" as success, so partially-provisioned friends converge. If the
   * instance is gone, its storage went with it: those steps are vacuously done
   * (else the mc calls would wedge on connection-refused, keeping the tombstone
   * forever). Returns a per-step success map the caller folds into `results`.
   */
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

  /** Returns the manual user-removal advisory (invite friends, no-token or
   * guarded-out cases), else undefined. */
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

  /**
   * Revoke a friend's tailnet identity. auth-key: delete the tagged nodes and
   * revoke the enrollment key. invite: revoke a still-pending invite, then
   * delete the joined user only when it's unambiguously safe (see
   * deleteInvitedUserOrAdvise), else return a manual-removal advisory.
   */
  private async tearDownEnrollment(
    ctx: FriendProvisionContext,
    log: Logger,
  ): Promise<string | undefined> {
    if (ctx.enrollmentMode !== "invite") {
      await this.revokeFriendNodes(ctx.nodeTag);
      // Unused the key stays live ~90 days; absent id / already-revoked = ok.
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

  /**
   * Delete the joined tailnet user, but ONLY when it's unambiguously this
   * friend's and safe: no other live portion shares the email, the user
   * actually joined, and it's a plain member (never an owner/admin — deleting
   * one could lock the admin out of the whole tailnet). Otherwise advise manual
   * removal — the blast radius is too large to guess.
   */
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

  /** ACL grant subject: an invited friend's login email (identity-src) or an
   * auth-key friend's node tag. */
  private aclSrcFor(ctx: FriendProvisionContext): string {
    return ctx.enrollmentMode === "invite" && ctx.inviteEmail
      ? ctx.inviteEmail
      : ctx.nodeTag;
  }

  /**
   * Remove the friend's policy entries — except in manual ACL mode, where the
   * token can't edit the policy (the add path skipped the write too): calling
   * the API would 403 AFTER the user/bucket are gone, wedging the friend row.
   * Removal is then the admin's job; offboard advises via OffboardResult, the
   * sweep can only log.
   */
  private async removeAclOrAdvise(src: string, log: Logger): Promise<void> {
    if (this.config.aclMode === "manual") {
      log.info("manual ACL mode — admin should remove the policy entries", {
        src,
      });
      return;
    }
    await this.tailscale.removeFriendAcl(src);
  }

  /** Failure-reap: revoke a recorded pending invite so a retry doesn't
   * double-send. 404-tolerant; no-op for auth-key friends / no token. */
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

  /** Dedicated → always reap; shared → only when this was the last friend. */
  private async reapInstanceIfEmpty(
    ctx: FriendProvisionContext,
    log: Logger,
  ): Promise<void> {
    // Count + mark in one transaction; a false return means friends remain
    // (or a concurrent add just reserved onto the pool) — leave it alone.
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

  /**
   * Run `fn`, logging + swallowing any error — teardown must be best-effort.
   * Returns whether it succeeded so callers can gate tombstone deletion on
   * resource teardown (a DB row must never be deleted while a resource it
   * records may still exist).
   */
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

  /** Delete an instance's own (serve) tailnet node. Match by stored ID (stable
   * across control-plane renames); fall back to hostname for pre-column
   * instances. Absent = already gone = success. */
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

  /** Best-effort teardown of a failed friend's (possibly partial) resources. */
  private async reapFriend(friendId: number, log: Logger): Promise<void> {
    const ctx = await this.repo.context(friendId).catch(() => null);
    if (!ctx) return; // already reaped
    const rlog = log.child({ reapFriendId: friendId, name: ctx.name });
    // A COMPLIANCE bucket with data is untouchable until retention lapses —
    // skip the whole reap (keeping the tombstone) rather than half-tearing
    // the friend down around an undeletable bucket.
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
      // Invite friends: drop a dangling pending invite so a retry doesn't
      // double-send. Inert (no-op) for auth-key friends.
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

  /** Reap an orphaned failed instance (no friend rows): container + volumes + row. */
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

  /**
   * Boot recovery: any row still `provisioning` at process start is
   * a crashed provision — fail it so the sweep (run right after in main.ts)
   * reaps it on the same boot and frees the name/port.
   */
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
    // Sequential (Promise chain, not a loop) — each reap frees its instance.
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

  /**
   * COMPLIANCE-locked objects cannot be deleted by anyone — root bypass
   * included — until their retention lapses. Refuse BEFORE any destructive
   * step, or the teardown fails opaquely halfway with the user/policy already
   * gone. Earliest-offboard estimate is conservative: every lock expires at
   * most retentionDays after its write, and writes can't be in the future,
   * so now + retentionDays always suffices. An empty bucket has no locks —
   * proceed. A failed usage check proceeds too: the rm step will surface a
   * genuine lock, and retries stay safe (all steps are idempotent).
   */
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

  /**
   * Remove every IAM user attached to the friend's bucket-scoped policy except
   * `keep`. MinIO is the source of truth for which users belong to a friend:
   * a failed rotation can leave a live user no DB row records, and this sweep
   * is how it converges (run at the start of rotate and during teardown).
   */
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
    // Prefix the tailnet hostname with p0rt1on- so the serve URL is
    // p0rt1on-<name>.<tailnet>.ts.net (the friend's endpoint carries the brand).
    return {
      bucket: name,
      nodeTag: `tag:p0rt1on-friend-${name}`,
      tsHostname: isolationMode === "shared"
        ? `p0rt1on-${this.config.sharedInstanceName}`
        : `p0rt1on-${name}`,
    };
  }

  private endpointFor(tsHostname: string): string {
    return `${this.config.serveMode}://${tsHostname}.${this.config.tailnetDomain}`;
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

  /** The runtime spec from an instance's identity alone — image/tag from config,
   * root cred derived from the hostname. Used by add (via specFor) and recover. */
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
    };
  }

  private buildAddBundle(
    input: AddFriendInput,
    naming: FriendNaming,
    reservation: InstanceReservation,
    cred: S3Credential,
    enroll: EnrollmentResult,
    manualAclInstructions?: string,
  ): FriendBundle {
    const endpoint = this.endpointFor(reservation.tsHostname);
    const base: FriendBundle = {
      name: input.name,
      s3Endpoint: endpoint,
      bucket: naming.bucket,
      s3AccessKeyId: cred.accessKeyId,
      s3SecretKey: cred.secretKey,
      enrollmentMode: enroll.mode,
      manualAclInstructions,
      // Join preamble differs by mode: auth-key redeems the minted key; invite
      // has the friend generate their own key in their Tailscale account.
      kopiaQuickstart: this.kopiaQuickstart({
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
    if (enroll.mode === "authKey") {
      return {
        ...base,
        tsAuthKey: enroll.tsAuthKey,
        tailscaleUpCommand: `tailscale up --authkey=${enroll.tsAuthKey}`,
      };
    }
    return {
      ...base,
      inviteEmail: enroll.email,
      inviteUrl: enroll.inviteUrl,
      inviteEmailedAt: enroll.inviteEmailedAt,
      manualInviteInstructions: enroll.manualInstructions,
      warnings: enroll.warning ? [enroll.warning] : undefined,
    };
  }

  private buildRotateBundle(
    ctx: FriendProvisionContext,
    cred: S3Credential,
    warnings: string[],
  ): FriendBundle {
    const endpoint = this.endpointFor(ctx.tsHostname);
    return {
      warnings: warnings.length > 0 ? warnings : undefined,
      name: ctx.name,
      s3Endpoint: endpoint,
      bucket: ctx.bucket,
      s3AccessKeyId: cred.accessKeyId,
      s3SecretKey: cred.secretKey,
      // tsAuthKey / tailscaleUpCommand omitted — node already enrolled; the repo
      // already exists, so this is a `connect` (with the rotated key).
      kopiaQuickstart: this.kopiaQuickstart({
        endpoint,
        bucket: ctx.bucket,
        cred,
        retentionDays: ctx.lockRetentionDays,
        create: false,
      }),
    };
  }

  /**
   * Copy-pasteable Kopia setup for the bundle. `create` (add) arms retention +
   * a new repo; `connect` (rotate) reuses the existing repo with the new key.
   * `tailscaleUpCommand` prepends a tailnet-join preamble (auth-key add only) —
   * invite friends join with their own account, rotate needs no join. Mirrors
   * backup-client/entrypoint.
   */
  private kopiaQuickstart(opts: {
    endpoint: string;
    bucket: string;
    cred: S3Credential;
    retentionDays: number;
    create: boolean;
    joinLines?: string[];
  }): string {
    const host = opts.endpoint.replace(/^https?:\/\//, "");
    const create = opts.create;
    const join = opts.joinLines ?? [];
    const password = create
      ? "# Choose YOUR OWN password — client-side only, NEVER sent to us, and"
      : "# Use the SAME KOPIA_PASSWORD you set when the repo was created —";
    const lastCredFlag = create
      ? `  --secret-access-key=${opts.cred.secretKey} \\`
      : `  --secret-access-key=${opts.cred.secretKey}`;
    const tail = create ? kopiaCreateTail(opts.retentionDays) : [];
    return [
      ...join,
      password,
      "# UNRECOVERABLE if lost:",
      "export KOPIA_PASSWORD='change-me-to-a-strong-passphrase'",
      "",
      `kopia repository ${create ? "create" : "connect"} s3 \\`,
      `  --bucket=${opts.bucket} \\`,
      `  --endpoint=${host} \\`,
      `  --access-key=${opts.cred.accessKeyId} \\`,
      lastCredFlag,
      ...tail,
    ].join("\n");
  }
}
