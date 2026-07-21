import { and, count, eq, ne } from "drizzle-orm";
import type { AddFriendInput, FriendStatus } from "@p0rt1on/shared/domain";
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

/** The transaction handle drizzle passes to a `db.transaction(...)` callback. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Repo-level config the data layer needs (subset of ProvisioningConfig). */
export interface RepoConfig {
  portRange: { min: number; max: number };
  /** Server-side serve-node tag stored on the `instances` row. */
  serveNodeTag: string;
  /**
   * Bind-probe on the publish interface — skips ports a foreign process
   * holds that the DB doesn't know about. Absent = DB-only allocation.
   */
  probePort?: PortProbe;
}

/**
 * Drizzle/SQLite implementation of ProvisioningRepo. The atomic "reserve" runs
 * in a transaction so a crash can't half-create a friend/instance. Stores no
 * secret — only the access key **ID**.
 */
export class DrizzleProvisioningRepo implements ProvisioningRepo {
  constructor(
    private readonly db: Db,
    private readonly config: RepoConfig,
  ) {}

  // The repo's methods are synchronous SQLite calls exposed as Promises
  // (interface contract). Each body runs via defer() so any throw —
  // exhausted port range, FK violation, NOT_FOUND — rejects instead of
  // throwing synchronously; callers rely on `.catch()` semantics.

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

  recordServeNodeId(instanceId: number, serveNodeId: string): Promise<void> {
    return defer(() => {
      this.db.update(instances).set({ serveNodeId })
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
    // Two-row status flip must be atomic — a crash between the friend and
    // instance updates leaves a state the boot sweep cannot interpret.
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
    // Atomic for the same reason as activate (friend + possibly instance row).
    return defer(() => {
      this.db.transaction((tx) => this.failFriendRow(tx, friendId));
    });
  }

  failStaleProvisioning(): Promise<string[]> {
    // At boot any `provisioning` row is stale — provisioning only ever happens
    // inside the running process, so no cross-restart concurrency exists. One
    // transaction so a crash mid-flip can't leave a half-recovered set.
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
    // Count + mark in ONE transaction: between a separate count and the
    // container teardown a concurrent add could reserve onto this instance
    // (reap-vs-add TOCTOU). Once marked, reserveTx refuses to adopt it.
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
    }[]
  > {
    return defer(() =>
      this.db.select({
        instanceId: instances.id,
        tsHostname: instances.tsHostname,
        minioPort: instances.minioPort,
        status: instances.status,
      }).from(instances).where(ne(instances.status, "failed")).all()
    );
  }

  failInstanceMissing(instanceId: number): Promise<number> {
    // The instance's container is gone (host wipe, manual docker rm): fail the
    // instance and every non-failed friend on it in one transaction so the
    // sweep reaps the rows and frees the names. Data is already gone — this
    // only makes the DB stop lying about it.
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
    // friends.id is referenced (with no ON DELETE CASCADE) by usage, activity,
    // and audit — deleting the friend while any of those rows exist trips a
    // FOREIGN KEY constraint. Drop the friend-scoped metric rows, but preserve
    // the audit trail by nulling its (nullable) friendId. One transaction so a
    // crash can't leave the friend deleted with orphaned children (or vice-versa).
    return defer(() => {
      this.db.transaction((tx) => {
        tx.update(auditTable).set({ friendId: null })
          .where(eq(auditTable.friendId, friendId)).run();
        // no-param-mutation flags `.delete()` on the `tx` param as a Map/Set
        // mutation — a false positive for drizzle's query builder.
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
    action: string,
    detail?: string,
  ): Promise<void> {
    return defer(() => {
      this.db.insert(auditTable).values({ friendId, action, detail }).run();
    });
  }

  // ---- transaction body + helpers ----

  private reserveTx(
    tx: Tx,
    input: AddFriendInput,
    naming: FriendNaming,
  ): InstanceReservation {
    const instance = input.isolationMode === "shared"
      ? this.resolveSharedInstance(tx, naming)
      : this.createInstance(tx, "dedicated", naming);
    const friendId = this.insertFriend(tx, input, naming, instance.instanceId);
    // Use the instance row's PERSISTED hostname, not the config-derived one:
    // when adopting an existing shared instance they can differ (config
    // changed since the pool was created) and the bundle must point at the
    // endpoint that actually exists.
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
    // Never adopt an instance in a terminal or reaping state: a concurrent
    // offboard's reap may be tearing it down right now — adopting it would
    // strand the new friend on a removed container (`instanceExisted: true`
    // skips container start).
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
    // Count ALL instance ports as used, not just non-failed ones: a failed row
    // still occupies its port (minio_port is UNIQUE) until the cleanup sweep
    // deletes it, so excluding it would collide on insert.
    const used = new Set(
      tx.select({ port: instances.minioPort }).from(instances).all()
        .map((r) => r.port),
    );
    const { min, max } = this.config.portRange;
    // Bind-probe each DB-free candidate: without it a foreign process on an
    // in-range port makes every allocation re-pick the same busy port —
    // a permanent failure loop.
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

  /** markFailed semantics over either the db or a transaction handle. */
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
