import { and, count, eq, ne } from "drizzle-orm";
import type {
  AddFriendInput,
  AuditAction,
  FriendStatus,
} from "@p0rt1on/shared/domain";
import type { Db } from "./Database.ts";
import {
  activity,
  audit as auditTable,
  friends,
  instances,
  usage,
} from "./Schema.ts";
import { ConflictError, NotFoundError } from "../lib/ServiceError.ts";
import { defer } from "../lib/defer.ts";
import type { PortProbe } from "../lib/net.ts";
import type {
  FriendNaming,
  FriendProvisionContext,
  InstanceReservation,
  ProvisioningRepo,
} from "../provisioning/deps.ts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface RepoConfig {
  portRange: { min: number; max: number };
  serveNodeTag: string;
  /**
   * Bind-probes the publish interface for ports a foreign process holds that
   * the DB doesn't know about. If absent, port allocation is DB-only.
   */
  probePort?: PortProbe;
}

/**
 * Reserve runs in one transaction so a crash cannot half-create a
 * friend/instance. Only the access key ID is stored; the secret never persists.
 */
export class DrizzleProvisioningRepo implements ProvisioningRepo {
  constructor(
    private readonly db: Db,
    private readonly config: RepoConfig,
  ) {}

  // Each method is a synchronous SQLite call wrapped in defer() so it returns
  // a rejected Promise instead of throwing synchronously; callers rely on `.catch()`.

  reserveFriend(
    input: AddFriendInput,
    naming: FriendNaming,
  ): Promise<InstanceReservation> {
    return defer(() =>
      this.db.transaction((tx) => this.reserveTx(tx, input, naming))
    );
  }

  recordAccessKey(friendId: number, accessKeyId: string): Promise<void> {
    return defer(() => {
      this.db.update(friends).set({ s3AccessKeyId: accessKeyId })
        .where(eq(friends.id, friendId)).run();
    });
  }

  recordTsKeyId(friendId: number, tsKeyId: string): Promise<void> {
    return defer(() => {
      this.db.update(friends).set({ tsKeyId })
        .where(eq(friends.id, friendId)).run();
    });
  }

  recordInvite(
    friendId: number,
    invite: { email: string; inviteId: string | null; status: string },
  ): Promise<void> {
    return defer(() => {
      this.db.update(friends).set({
        enrollmentMode: "invite",
        inviteEmail: invite.email,
        inviteId: invite.inviteId,
        inviteStatus: invite.status,
      }).where(eq(friends.id, friendId)).run();
    });
  }

  recordServeNodeId(instanceId: number, serveNodeId: string): Promise<void> {
    return defer(() => {
      this.db.update(instances).set({ serveNodeId })
        .where(eq(instances.id, instanceId)).run();
    });
  }

  recordConfirmedHostname(
    instanceId: number,
    tsHostname: string,
  ): Promise<void> {
    return defer(() => {
      this.db.update(instances).set({ tsHostname })
        .where(eq(instances.id, instanceId)).run();
    });
  }

  setQuota(friendId: number, quotaBytes: number): Promise<void> {
    return defer(() => {
      this.db.update(friends).set({ quotaBytes })
        .where(eq(friends.id, friendId)).run();
    });
  }

  setStatus(friendId: number, status: FriendStatus): Promise<void> {
    return defer(() => {
      this.db.update(friends).set({ status })
        .where(eq(friends.id, friendId)).run();
    });
  }

  activate(friendId: number, instanceId: number): Promise<void> {
    // The friend and instance status updates must flip atomically; a crash
    // between them would leave a state the boot sweep cannot interpret.
    return defer(() => {
      this.db.transaction((tx) => {
        tx.update(friends).set({ status: "active" })
          .where(eq(friends.id, friendId)).run();
        tx.update(instances).set({ status: "active" })
          .where(eq(instances.id, instanceId)).run();
      });
    });
  }

  markFailed(friendId: number): Promise<void> {
    return defer(() => {
      this.db.transaction((tx) => this.failFriendRow(tx, friendId));
    });
  }

  failStaleProvisioning(): Promise<string[]> {
    // At boot, any row still in provisioning state is stale, since provisioning
    // only happens inside the running process; all rows flip in one transaction.
    return defer(() =>
      this.db.transaction((tx) => {
        const stale = tx.select({ id: friends.id, name: friends.name })
          .from(friends).where(eq(friends.status, "provisioning")).all();
        stale.forEach((row) => this.failFriendRow(tx, row.id));
        return stale.map((r) => r.name);
      })
    );
  }

  context(friendId: number): Promise<FriendProvisionContext> {
    return defer(() => this.contextSync(friendId));
  }

  private contextSync(friendId: number): FriendProvisionContext {
    const row = this.db.select({
      id: friends.id,
      name: friends.name,
      isolationMode: friends.isolationMode,
      bucket: friends.bucket,
      s3AccessKeyId: friends.s3AccessKeyId,
      tsKeyId: friends.tsKeyId,
      nodeTag: friends.tsNodeTag,
      enrollmentMode: friends.enrollmentMode,
      inviteEmail: friends.inviteEmail,
      inviteId: friends.inviteId,
      lockMode: friends.lockMode,
      lockRetentionDays: friends.lockRetentionDays,
      instanceId: friends.instanceId,
      tsHostname: instances.tsHostname,
      serveNodeId: instances.serveNodeId,
      minioPort: instances.minioPort,
    }).from(friends)
      .innerJoin(instances, eq(friends.instanceId, instances.id))
      .where(eq(friends.id, friendId)).get();
    if (!row) throw new NotFoundError(`friend ${friendId} not found`);
    return {
      ...row,
      friendId: row.id,
      instanceName: row.tsHostname,
      alias: row.tsHostname,
    };
  }

  otherFriendsWithInviteEmail(
    excludeFriendId: number,
    email: string,
  ): Promise<number> {
    return defer(() => {
      const row = this.db.select({ c: count() }).from(friends)
        .where(and(
          eq(friends.inviteEmail, email),
          ne(friends.id, excludeFriendId),
          ne(friends.status, "failed"),
        )).get();
      return row ? row.c : 0;
    });
  }

  friendsOnInstance(instanceId: number): Promise<number> {
    return defer(() => this.liveFriendsOn(instanceId));
  }

  liveFriendTagsOnInstance(instanceId: number): Promise<string[]> {
    return defer(() =>
      this.db.select({ tag: friends.tsNodeTag }).from(friends)
        .where(
          and(eq(friends.instanceId, instanceId), ne(friends.status, "failed")),
        ).all().map((r) => r.tag)
    );
  }

  markInstanceReaping(
    instanceId: number,
    opts: { requireEmpty: boolean },
  ): Promise<boolean> {
    // The count and status flip run in one transaction, closing a window where
    // a concurrent add could reserve onto this instance between count and teardown.
    return defer(() =>
      this.db.transaction((tx) => {
        if (opts.requireEmpty && this.liveFriendsOn(instanceId, tx) > 0) {
          return false;
        }
        tx.update(instances).set({ status: "reaping" })
          .where(eq(instances.id, instanceId)).run();
        return true;
      })
    );
  }

  failedFriendIds(): Promise<number[]> {
    return defer(() =>
      this.db.select({ id: friends.id }).from(friends)
        .where(eq(friends.status, "failed")).all().map((r) => r.id)
    );
  }

  liveInstances(): Promise<
    {
      instanceId: number;
      tsHostname: string;
      minioPort: number;
      status: string;
      serveNodeId: string | null;
    }[]
  > {
    return defer(() =>
      this.db.select({
        instanceId: instances.id,
        tsHostname: instances.tsHostname,
        minioPort: instances.minioPort,
        status: instances.status,
        serveNodeId: instances.serveNodeId,
      }).from(instances).where(ne(instances.status, "failed")).all()
    );
  }

  failInstanceMissing(instanceId: number): Promise<number> {
    // The container may be gone already (host wipe, manual docker rm); this fails
    // the instance and its non-failed friends in one transaction so the sweep reaps them.
    return defer(() =>
      this.db.transaction((tx) => {
        const live = tx.select({ id: friends.id }).from(friends)
          .where(and(
            eq(friends.instanceId, instanceId),
            ne(friends.status, "failed"),
          )).all();
        live.forEach((row) =>
          tx.update(friends).set({ status: "failed" })
            .where(eq(friends.id, row.id)).run()
        );
        tx.update(instances).set({ status: "failed" })
          .where(eq(instances.id, instanceId)).run();
        return live.length;
      })
    );
  }

  failedInstances(): Promise<
    { instanceId: number; tsHostname: string; serveNodeId: string | null }[]
  > {
    return defer(() =>
      this.db.select({
        instanceId: instances.id,
        tsHostname: instances.tsHostname,
        serveNodeId: instances.serveNodeId,
      }).from(instances).where(eq(instances.status, "failed")).all()
    );
  }

  deleteFriend(friendId: number): Promise<void> {
    // friends.id has no ON DELETE CASCADE, so usage/activity rows are deleted and
    // audit rows keep their friendId nulled to preserve history; all in one transaction.
    return defer(() => {
      this.db.transaction((tx) => {
        tx.update(auditTable).set({ friendId: null })
          .where(eq(auditTable.friendId, friendId)).run();
        // no-param-mutation flags `.delete()` on the `tx` param as a Map/Set
        // mutation; this is a false positive for drizzle's query builder.
        // deno-lint-ignore custom-no-param-mutation/no-param-mutation
        tx.delete(usage).where(eq(usage.friendId, friendId)).run();
        // deno-lint-ignore custom-no-param-mutation/no-param-mutation
        tx.delete(activity).where(eq(activity.friendId, friendId)).run();
        // deno-lint-ignore custom-no-param-mutation/no-param-mutation
        tx.delete(friends).where(eq(friends.id, friendId)).run();
      });
    });
  }

  deleteInstance(instanceId: number): Promise<void> {
    return defer(() => {
      this.db.delete(instances).where(eq(instances.id, instanceId)).run();
    });
  }

  audit(
    friendId: number | null,
    action: AuditAction,
    detail?: string,
  ): Promise<void> {
    return defer(() => {
      // The name is snapshotted now because offboard deletes the friend row (and
      // nulls friendId on surviving audit rows), so a later live join would lose it.
      const friendName = friendId === null ? null : (this.db
        .select({ name: friends.name }).from(friends)
        .where(eq(friends.id, friendId)).get()?.name ?? null);
      this.db.insert(auditTable).values({
        friendId,
        friendName,
        action,
        detail,
      })
        .run();
    });
  }

  private reserveTx(
    tx: Tx,
    input: AddFriendInput,
    naming: FriendNaming,
  ): InstanceReservation {
    const instance = input.isolationMode === "shared"
      ? this.resolveSharedInstance(tx, naming)
      : this.createInstance(tx, "dedicated", naming);
    const friendId = this.insertFriend(tx, input, naming, instance.instanceId);
    // The persisted instance hostname is used instead of the config-derived one,
    // since adopting an existing shared pool can leave them different if config changed.
    return {
      friendId,
      instanceId: instance.instanceId,
      alias: instance.tsHostname,
      hostPort: instance.hostPort,
      tsHostname: instance.tsHostname,
      instanceExisted: instance.instanceExisted,
    };
  }

  private resolveSharedInstance(
    tx: Tx,
    naming: FriendNaming,
  ): {
    instanceId: number;
    hostPort: number;
    tsHostname: string;
    instanceExisted: boolean;
  } {
    // An instance in a terminal or reaping state is never adopted, because a
    // concurrent offboard's reap may be tearing it down right now.
    const existing = tx.select({
      instanceId: instances.id,
      hostPort: instances.minioPort,
      tsHostname: instances.tsHostname,
    }).from(instances)
      .where(and(
        eq(instances.kind, "shared"),
        ne(instances.status, "failed"),
        ne(instances.status, "reaping"),
      ))
      .get();
    if (existing) return { ...existing, instanceExisted: true };
    return this.createInstance(tx, "shared", naming);
  }

  private createInstance(
    tx: Tx,
    kind: "dedicated" | "shared",
    naming: FriendNaming,
  ): {
    instanceId: number;
    hostPort: number;
    tsHostname: string;
    instanceExisted: boolean;
  } {
    const hostPort = this.allocatePort(tx);
    const inserted = tx.insert(instances).values({
      kind,
      minioPort: hostPort,
      tsHostname: naming.tsHostname,
      tsTag: this.config.serveNodeTag,
    }).returning({ id: instances.id }).all();
    return {
      instanceId: inserted[0].id,
      hostPort,
      tsHostname: naming.tsHostname,
      instanceExisted: false,
    };
  }

  private allocatePort(tx: Tx): number {
    // All instance ports count as used, not just non-failed ones: minio_port is
    // unique across all rows, and a failed row keeps its port until the cleanup sweep.
    const used = new Set(
      tx.select({ port: instances.minioPort }).from(instances).all()
        .map((r) => r.port),
    );
    const { min, max } = this.config.portRange;
    // Each DB-free candidate is bind-probed; without it a foreign process holding
    // an in-range port would make every allocation re-pick the same busy port.
    const probe = this.config.probePort ?? (() => true);
    const free = Array.from({ length: max - min + 1 }, (_, i) => min + i)
      .find((port) => !used.has(port) && probe(port));
    if (free === undefined) throw new ConflictError("no free MinIO port");
    return free;
  }

  private insertFriend(
    tx: Tx,
    input: AddFriendInput,
    naming: FriendNaming,
    instanceId: number,
  ): number {
    const inserted = tx.insert(friends).values({
      name: input.name,
      isolationMode: input.isolationMode,
      instanceId,
      bucket: naming.bucket,
      quotaBytes: input.quotaBytes,
      lockMode: input.lockMode,
      lockRetentionDays: input.retentionDays,
      tsNodeTag: naming.nodeTag,
    }).returning({ id: friends.id }).all();
    return inserted[0].id;
  }

  private failFriendRow(h: Db | Tx, friendId: number): void {
    const row = h.select({ instanceId: friends.instanceId })
      .from(friends).where(eq(friends.id, friendId)).get();
    h.update(friends).set({ status: "failed" })
      .where(eq(friends.id, friendId)).run();
    // A brand-new instance with no surviving friends is failed too.
    if (row && this.liveFriendsOn(row.instanceId, h) === 0) {
      h.update(instances).set({ status: "failed" })
        .where(eq(instances.id, row.instanceId)).run();
    }
  }

  private liveFriendsOn(instanceId: number, h: Db | Tx = this.db): number {
    const row = h.select({ c: count() }).from(friends)
      .where(
        and(eq(friends.instanceId, instanceId), ne(friends.status, "failed")),
      ).get();
    return row ? row.c : 0;
  }
}
