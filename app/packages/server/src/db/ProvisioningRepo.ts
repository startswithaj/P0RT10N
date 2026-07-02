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

  // deno-lint-ignore require-await
  async reserveFriend(
    input: AddFriendInput,
    naming: FriendNaming,
  ): Promise<InstanceReservation> {
    // async so a transaction throw (e.g. exhausted port range) rejects rather
    // than throwing synchronously.
    return this.db.transaction((tx) => this.reserveTx(tx, input, naming));
  }

  // deno-lint-ignore require-await
  async recordAccessKey(friendId: number, accessKeyId: string): Promise<void> {
    this.db.update(friends).set({ s3AccessKeyId: accessKeyId })
      .where(eq(friends.id, friendId)).run();
  }

  // deno-lint-ignore require-await
  async setQuota(friendId: number, quotaBytes: number): Promise<void> {
    this.db.update(friends).set({ quotaBytes })
      .where(eq(friends.id, friendId)).run();
  }

  // deno-lint-ignore require-await
  async setStatus(friendId: number, status: FriendStatus): Promise<void> {
    this.db.update(friends).set({ status })
      .where(eq(friends.id, friendId)).run();
  }

  // deno-lint-ignore require-await
  async activate(friendId: number, instanceId: number): Promise<void> {
    this.db.update(friends).set({ status: "active" })
      .where(eq(friends.id, friendId)).run();
    this.db.update(instances).set({ status: "active" })
      .where(eq(instances.id, instanceId)).run();
  }

  // deno-lint-ignore require-await
  async markFailed(friendId: number): Promise<void> {
    const row = this.db.select({ instanceId: friends.instanceId })
      .from(friends).where(eq(friends.id, friendId)).get();
    this.db.update(friends).set({ status: "failed" })
      .where(eq(friends.id, friendId)).run();
    // A brand-new instance with no surviving friends is failed too.
    if (row && this.liveFriendsOn(row.instanceId) === 0) {
      this.db.update(instances).set({ status: "failed" })
        .where(eq(instances.id, row.instanceId)).run();
    }
  }

  // deno-lint-ignore require-await
  async context(friendId: number): Promise<FriendProvisionContext> {
    const row = this.db.select({
      id: friends.id,
      name: friends.name,
      isolationMode: friends.isolationMode,
      bucket: friends.bucket,
      s3AccessKeyId: friends.s3AccessKeyId,
      nodeTag: friends.tsNodeTag,
      lockMode: friends.lockMode,
      lockRetentionDays: friends.lockRetentionDays,
      instanceId: friends.instanceId,
      tsHostname: instances.tsHostname,
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

  // deno-lint-ignore require-await
  async friendsOnInstance(instanceId: number): Promise<number> {
    return this.liveFriendsOn(instanceId);
  }

  // deno-lint-ignore require-await
  async failedFriendIds(): Promise<number[]> {
    return this.db.select({ id: friends.id }).from(friends)
      .where(eq(friends.status, "failed")).all().map((r) => r.id);
  }

  // deno-lint-ignore require-await
  async failedInstances(): Promise<
    { instanceId: number; tsHostname: string }[]
  > {
    return this.db.select({
      instanceId: instances.id,
      tsHostname: instances.tsHostname,
    }).from(instances).where(eq(instances.status, "failed")).all();
  }

  // deno-lint-ignore require-await
  async deleteFriend(friendId: number): Promise<void> {
    // friends.id is referenced (with no ON DELETE CASCADE) by usage, activity,
    // and audit — deleting the friend while any of those rows exist trips a
    // FOREIGN KEY constraint. Drop the friend-scoped metric rows, but preserve
    // the audit trail by nulling its (nullable) friendId. One transaction so a
    // crash can't leave the friend deleted with orphaned children (or vice-versa).
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
  }

  // deno-lint-ignore require-await
  async deleteInstance(instanceId: number): Promise<void> {
    this.db.delete(instances).where(eq(instances.id, instanceId)).run();
  }

  // deno-lint-ignore require-await
  async audit(
    friendId: number | null,
    action: string,
    detail?: string,
  ): Promise<void> {
    this.db.insert(auditTable).values({ friendId, action, detail }).run();
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
    return {
      friendId,
      instanceId: instance.instanceId,
      alias: naming.tsHostname,
      hostPort: instance.hostPort,
      tsHostname: naming.tsHostname,
      instanceExisted: instance.instanceExisted,
    };
  }

  private resolveSharedInstance(
    tx: Tx,
    naming: FriendNaming,
  ): { instanceId: number; hostPort: number; instanceExisted: boolean } {
    const existing = tx.select({
      instanceId: instances.id,
      hostPort: instances.minioPort,
    }).from(instances)
      .where(and(eq(instances.kind, "shared"), ne(instances.status, "failed")))
      .get();
    if (existing) return { ...existing, instanceExisted: true };
    return this.createInstance(tx, "shared", naming);
  }

  private createInstance(
    tx: Tx,
    kind: "dedicated" | "shared",
    naming: FriendNaming,
  ): { instanceId: number; hostPort: number; instanceExisted: boolean } {
    const hostPort = this.allocatePort(tx);
    const inserted = tx.insert(instances).values({
      kind,
      minioPort: hostPort,
      tsHostname: naming.tsHostname,
      tsTag: this.config.serveNodeTag,
    }).returning({ id: instances.id }).all();
    return { instanceId: inserted[0].id, hostPort, instanceExisted: false };
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
    const free = Array.from({ length: max - min + 1 }, (_, i) => min + i)
      .find((port) => !used.has(port));
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

  private liveFriendsOn(instanceId: number): number {
    const row = this.db.select({ c: count() }).from(friends)
      .where(
        and(eq(friends.instanceId, instanceId), ne(friends.status, "failed")),
      ).get();
    return row ? row.c : 0;
  }
}
