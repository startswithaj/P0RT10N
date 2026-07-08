import type {
  AddFriendInput,
  FriendBundle,
  IsolationMode,
  OffboardStepKey,
  ProvisionStepKey,
  TsKeyBundle,
} from "@p0rt1on/shared/domain";
import type { ProvisioningService as ProvisioningServiceContract } from "../services/types.ts";
import type { Logger } from "../services/types.ts";
import type { McClient, McClientFactory, S3Credential } from "../minio/mc.ts";
import type { InstanceRuntime, InstanceSpec } from "../runtime/runtime.ts";
import type { TempFiles } from "../lib/CommandRunner.ts";
import { containerNames } from "../runtime/names.ts";
import type { TailscaleApi } from "../tailscale/tailscale.ts";
import { manualAclInstructions } from "../tailscale/manualAcl.ts";
import { ServiceError } from "../lib/ServiceError.ts";
import { drainForResult } from "../lib/drainGenerator.ts";
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

/** Kopia quickstart: the tailnet-join preamble (add flow only). */
function kopiaJoinLines(tailscaleUpCommand: string): string[] {
  return [
    "# Join the tailnet (redeems your single-use key):",
    tailscaleUpCommand,
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
  constructor(
    private readonly config: ProvisioningConfig,
    private readonly repo: ProvisioningRepo,
    private readonly mc: McClientFactory,
    private readonly runtime: InstanceRuntime,
    private readonly tailscale: TailscaleApi,
    private readonly keyGen: KeyGen,
    private readonly tempFiles: TempFiles,
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
  async *addFriendStream(
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

  async rotateKey(friendId: number): Promise<FriendBundle> {
    const log = this.logger.child({ op: "rotateKey", friendId });
    log.info("rotating S3 key");
    const ctx = await this.repo.context(friendId);
    const mc = this.mc.forInstance({ alias: ctx.alias });
    const cred = this.keyGen.generateS3Credential();
    log.debug("replacing S3 user", {
      bucket: ctx.bucket,
      newAccessKeyId: cred.accessKeyId,
      oldAccessKeyId: ctx.s3AccessKeyId,
    });
    // Replace the user; the bucket-scoped policy already exists, just reattach.
    await this.replaceUser(mc, ctx, cred);
    await this.repo.recordAccessKey(friendId, cred.accessKeyId);
    await this.repo.audit(friendId, "rotate_key");
    log.info("S3 key rotated");
    // No tsAuthKey: the node is already enrolled (see FriendBundle docs).
    return this.buildRotateBundle(ctx, cred);
  }

  async reissueTsKey(friendId: number): Promise<TsKeyBundle> {
    const log = this.logger.child({ op: "reissueTsKey", friendId });
    log.info("re-issuing tailscale enrollment key");
    const ctx = await this.repo.context(friendId);
    const minted = await this.tailscale.mintAuthKey({ tag: ctx.nodeTag });
    await this.repo.audit(friendId, "reissue_ts_key");
    log.info("tailscale key re-issued", { tag: ctx.nodeTag });
    return {
      name: ctx.name,
      tsAuthKey: minted.key,
      tailscaleUpCommand: `tailscale up --authkey=${minted.key}`,
    };
  }

  /** Non-streaming offboard: drains the teardown stream to completion. */
  offboard(friendId: number): Promise<void> {
    return drainForResult(this.offboardStream(friendId));
  }

  /**
   * Tear a friend down, yielding a `step` event as each step begins and a final
   * `done` event. A throw propagates out, so the UI halts on the failing step.
   * Steps are named by key (see OFFBOARD_STEPS).
   */
  async *offboardStream(
    friendId: number,
  ): AsyncGenerator<ProgressEvent<OffboardStepKey, void>> {
    const log = this.logger.child({ op: "offboard", friendId });
    log.info("offboarding friend");
    const ctx = await this.repo.context(friendId);
    log.debug("tearing down friend resources", {
      bucket: ctx.bucket,
      nodeTag: ctx.nodeTag,
    });
    yield* this.tearDownSteps(ctx);
    yield { type: "step", step: "record" };
    // Record the offboard BEFORE deleting the friend row: the audit FK points at
    // friends.id, so inserting after the delete trips a FOREIGN KEY constraint.
    // deleteFriend nulls the friendId on surviving audit rows, so keep the name
    // in `detail` for the trail.
    await this.repo.audit(
      friendId,
      "offboard",
      `name=${ctx.name} mode=${ctx.isolationMode}`,
    );
    await this.repo.deleteFriend(friendId);
    yield { type: "step", step: "reap" };
    await this.reapInstanceIfEmpty(ctx, log);
    log.info("offboard complete", { isolationMode: ctx.isolationMode });
    yield { type: "done", result: undefined };
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
    const mc = this.mc.forInstance({ alias: reservation.alias });
    const cred = this.keyGen.generateS3Credential();
    log.info("step: ensure instance + ACL");
    // MUST precede minting the friend key: Tailscale rejects an auth key for a
    // tag that isn't yet declared in tagOwners, and ensureFriendAcl declares it.
    // In manual ACL mode this returns the grant lines the admin must paste.
    const manualAcl = yield* this.ensureInfraSteps(reservation, naming, log);
    yield { type: "step", step: "authkey" };
    log.debug("minting friend tailscale auth key", { tag: naming.nodeTag });
    const friendKey = await this.tailscale.mintAuthKey({ tag: naming.nodeTag });
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
      friendKey.key,
      manualAcl,
    );
  }

  /**
   * Ensure the instance is up (skip if the shared pool already runs), then ACL
   * the friend. In `manual` mode the manager can't edit the policy file, so it
   * skips the API call and returns the grant lines for the admin to paste.
   */
  private async *ensureInfraSteps(
    reservation: InstanceReservation,
    naming: FriendNaming,
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
    const endpointHostPort = `${ip}:443`;
    if (this.config.aclMode === "manual") {
      log.info("manual ACL mode — admin must add the grant by hand", {
        tag: naming.nodeTag,
      });
      // The admin owns their own tags when pasting into their policy.
      return manualAclInstructions(
        naming.nodeTag,
        endpointHostPort,
        "autogroup:admin",
      );
    }
    log.debug("applying friend ACL", {
      tag: naming.nodeTag,
      endpointHostPort,
    });
    await this.tailscale.ensureFriendAcl(naming.nodeTag, endpointHostPort);
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
    // The container needs its OWN serve auth key (server-side tag), separate
    // from the friend's enrollment key.
    const serveKey = await this.tailscale.mintAuthKey({
      tag: this.config.serveNodeTag,
    });
    // MinIO root creds + the serve auth key: written to an env-file for
    // `docker run` (baked into the container), removed after. The auth key
    // rides the env-file too — never the docker argv (host-visible via ps).
    // The root creds are then used to configure the mc alias so the manager
    // can admin the instance over the docker network.
    const rootCred = this.keyGen.rootCredentialFor(reservation.tsHostname);
    const envFile = await this.tempFiles.write(
      `MINIO_ROOT_USER=${rootCred.accessKeyId}\n` +
        `MINIO_ROOT_PASSWORD=${rootCred.secretKey}\n` +
        `TAILSCALE_AUTHKEY=${serveKey.key}\n`,
    );
    try {
      const spec = this.specFor(reservation, envFile);
      log.debug("starting instance container", {
        container: spec.name,
        minioPort: spec.minioPort,
        network: spec.network,
      });
      await this.runtime.ensureInstance(spec);
    } finally {
      await this.tempFiles.remove(envFile);
    }
    // `docker run` returns before MinIO is accepting connections; wait for the
    // container's HEALTHCHECK to pass before any admin (mc) call.
    log.debug("waiting for instance to become healthy", {
      tsHostname: reservation.tsHostname,
    });
    await this.runtime.waitUntilHealthy(reservation.tsHostname);
    const endpoint =
      `http://${this.config.instanceHost}:${reservation.hostPort}`;
    log.debug("configuring mc alias", { alias: reservation.alias, endpoint });
    await this.mc.setAlias(reservation.alias, endpoint, rootCred);
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
    const adminEndpoint =
      `http://${this.config.instanceHost}:${reservation.hostPort}`;
    log.debug("running smoke test", {
      bucket: naming.bucket,
      endpoint: adminEndpoint,
    });
    await this.smokeTester.run({
      endpoint: adminEndpoint,
      region: this.config.region,
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

  private async *tearDownSteps(
    ctx: FriendProvisionContext,
  ): AsyncGenerator<StepEvent<OffboardStepKey>, void> {
    const mc = this.mc.forInstance({ alias: ctx.alias });
    yield { type: "step", step: "storage" };
    if (ctx.s3AccessKeyId) await mc.removeUser(ctx.s3AccessKeyId);
    // The bucket-scoped IAM policy (named after the bucket) would otherwise
    // live in MinIO forever; absent is success.
    await mc.removePolicy(ctx.bucket);
    await mc.removeBucket(ctx.bucket); // force; deletes all versions
    yield { type: "step", step: "nodes" };
    await this.revokeFriendNodes(ctx.nodeTag);
    yield { type: "step", step: "acl" };
    await this.tailscale.removeFriendAcl(ctx.nodeTag);
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
    const remaining = await this.repo.friendsOnInstance(ctx.instanceId);
    const shouldReap = ctx.isolationMode === "dedicated" || remaining === 0;
    if (!shouldReap) {
      log.debug("instance still has friends; not reaping", {
        instanceId: ctx.instanceId,
        remaining,
      });
      return;
    }
    log.info("reaping instance", {
      instanceId: ctx.instanceId,
      instanceName: ctx.instanceName,
    });
    await this.runtime.removeInstance(ctx.instanceName, {
      removeVolumes: true,
    });
    await this.attempt(
      log,
      "revoke serve node",
      () => this.revokeServeNode(ctx.tsHostname),
    );
    await this.repo.deleteInstance(ctx.instanceId);
  }

  // ---- cleanup sweep (reap failed-provision tombstones) ----

  /** Run `fn`, logging + swallowing any error — teardown must be best-effort. */
  private async attempt(
    log: Logger,
    step: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      log.warn(`reap: ${step} failed (ignored)`, { error: String(err) });
    }
  }

  /** Delete an instance's own (serve) tailnet node, matched by hostname. */
  private async revokeServeNode(tsHostname: string): Promise<void> {
    const nodes = await this.tailscale.nodesByTag(this.config.serveNodeTag);
    await Promise.all(
      nodes.filter((n) => n.hostname === tsHostname)
        .map((n) => this.tailscale.deleteNode(n.nodeId)),
    );
  }

  /** Best-effort teardown of a failed friend's (possibly partial) resources. */
  private async reapFriend(friendId: number, log: Logger): Promise<void> {
    const ctx = await this.repo.context(friendId).catch(() => null);
    if (!ctx) return; // already reaped
    const rlog = log.child({ reapFriendId: friendId, name: ctx.name });
    rlog.info("reaping failed friend");
    const mc = this.mc.forInstance({ alias: ctx.alias });
    const ak = ctx.s3AccessKeyId;
    if (ak) await this.attempt(rlog, "removeUser", () => mc.removeUser(ak));
    await this.attempt(rlog, "removePolicy", () => mc.removePolicy(ctx.bucket));
    await this.attempt(rlog, "removeBucket", () => mc.removeBucket(ctx.bucket));
    await this.attempt(
      rlog,
      "removeAcl",
      () => this.tailscale.removeFriendAcl(ctx.nodeTag),
    );
    await this.attempt(
      rlog,
      "revokeNodes",
      () => this.revokeFriendNodes(ctx.nodeTag),
    );
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
    log: Logger,
  ): Promise<void> {
    await this.attempt(
      log,
      "removeInstance",
      () => this.runtime.removeInstance(tsHostname, { removeVolumes: true }),
    );
    await this.attempt(
      log,
      "revokeServeNode",
      () => this.revokeServeNode(tsHostname),
    );
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

  async sweepFailed(): Promise<number> {
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
        p.then(() => this.reapOrphanInstance(o.instanceId, o.tsHostname, log)),
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

  private async replaceUser(
    mc: McClient,
    ctx: FriendProvisionContext,
    cred: S3Credential,
  ): Promise<void> {
    if (ctx.s3AccessKeyId) await mc.removeUser(ctx.s3AccessKeyId);
    await mc.createUser(cred);
    await mc.attachPolicy(cred.accessKeyId, ctx.bucket);
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
    return `https://${tsHostname}.${this.config.tailnetDomain}`;
  }

  private specFor(
    reservation: InstanceReservation,
    rootCredSecretRef: string,
  ): InstanceSpec {
    const names = containerNames(reservation.tsHostname);
    return {
      name: names.container,
      image: this.config.instanceImage,
      tsHostname: reservation.tsHostname,
      tag: this.config.serveNodeTag,
      minioPort: reservation.hostPort,
      dataVolume: names.dataVolume,
      stateVolume: names.stateVolume,
      rootCredSecretRef,
      network: this.config.network,
    };
  }

  private buildAddBundle(
    input: AddFriendInput,
    naming: FriendNaming,
    reservation: InstanceReservation,
    cred: S3Credential,
    tsAuthKey: string,
    manualAclInstructions?: string,
  ): FriendBundle {
    const endpoint = this.endpointFor(reservation.tsHostname);
    return {
      name: input.name,
      s3Endpoint: endpoint,
      region: this.config.region,
      bucket: naming.bucket,
      s3AccessKeyId: cred.accessKeyId,
      s3SecretKey: cred.secretKey,
      tsAuthKey,
      tailscaleUpCommand: `tailscale up --authkey=${tsAuthKey}`,
      manualAclInstructions,
      kopiaQuickstart: this.kopiaQuickstart({
        endpoint,
        bucket: naming.bucket,
        cred,
        retentionDays: input.retentionDays,
        tailscaleUpCommand: `tailscale up --authkey=${tsAuthKey}`,
      }),
    };
  }

  private buildRotateBundle(
    ctx: FriendProvisionContext,
    cred: S3Credential,
  ): FriendBundle {
    const endpoint = this.endpointFor(ctx.tsHostname);
    return {
      name: ctx.name,
      s3Endpoint: endpoint,
      region: this.config.region,
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
      }),
    };
  }

  /**
   * Copy-pasteable Kopia setup for the bundle. `create` (add) also joins the
   * tailnet + arms retention; `connect` (rotate — no tailscaleUpCommand) reuses
   * the existing node + repo with the new key. Mirrors backup-client/entrypoint.
   */
  private kopiaQuickstart(opts: {
    endpoint: string;
    bucket: string;
    cred: S3Credential;
    retentionDays: number;
    tailscaleUpCommand?: string;
  }): string {
    const host = opts.endpoint.replace(/^https?:\/\//, "");
    const create = opts.tailscaleUpCommand !== undefined;
    const join = opts.tailscaleUpCommand === undefined
      ? []
      : kopiaJoinLines(opts.tailscaleUpCommand);
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
      `  --region=${this.config.region} \\`,
      `  --access-key=${opts.cred.accessKeyId} \\`,
      lastCredFlag,
      ...tail,
    ].join("\n");
  }
}
