import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { DrizzleProvisioningRepo } from "./ProvisioningRepo.ts";
import type { Database } from "./Database.ts";
import {
  createTestDatabase,
  makeAddInput,
  namingFor,
  seedActivity,
  seedUsage,
  TEST_REPO_CONFIG,
} from "../test-helpers/testDb.ts";

describe("DrizzleProvisioningRepo", () => {
  let database: Database;
  let repo: DrizzleProvisioningRepo;

  beforeEach(() => {
    database = createTestDatabase();
    repo = new DrizzleProvisioningRepo(database.db, TEST_REPO_CONFIG);
  });

  afterEach(() => {
    database.driver.close();
  });

  it("dedicated: creates a new instance + friend and allocates the first free port", async () => {
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );

    expect(res.instanceExisted).toBe(false);
    expect(res.hostPort).toBe(9000); // first in the test range
    expect(res.tsHostname).toBe("alice");
    expect(res.friendId).toBeGreaterThan(0);
  });

  it("allocates distinct ports across dedicated friends, skipping used ones", async () => {
    const a = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    const b = await repo.reserveFriend(
      makeAddInput("bob", "dedicated"),
      namingFor("bob", "dedicated"),
    );

    expect(a.hostPort).toBe(9000);
    expect(b.hostPort).toBe(9001);
    expect(a.instanceId).not.toBe(b.instanceId);
  });

  it("throws CONFLICT when the port range is exhausted", async () => {
    // Range is 9000..9002 (3 ports).
    await repo.reserveFriend(
      makeAddInput("a", "dedicated"),
      namingFor("a", "dedicated"),
    );
    await repo.reserveFriend(
      makeAddInput("b", "dedicated"),
      namingFor("b", "dedicated"),
    );
    await repo.reserveFriend(
      makeAddInput("c", "dedicated"),
      namingFor("c", "dedicated"),
    );

    await expect(
      repo.reserveFriend(
        makeAddInput("d", "dedicated"),
        namingFor("d", "dedicated"),
      ),
    ).rejects.toThrow("no free MinIO port");
  });

  it("shared: first friend creates the pool, second reuses it (no new port)", async () => {
    const first = await repo.reserveFriend(
      makeAddInput("bob", "shared"),
      namingFor("bob", "shared"),
    );
    const second = await repo.reserveFriend(
      makeAddInput("carol", "shared"),
      namingFor("carol", "shared"),
    );

    expect(first.instanceExisted).toBe(false);
    expect(second.instanceExisted).toBe(true);
    expect(second.instanceId).toBe(first.instanceId);
    expect(second.hostPort).toBe(first.hostPort);
  });

  it("records the access key ID and activates", async () => {
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    await repo.recordAccessKey(res.friendId, "AKIANEW");
    await repo.activate(res.friendId, res.instanceId);

    const ctx = await repo.context(res.friendId);
    expect(ctx.s3AccessKeyId).toBe("AKIANEW");
    expect(ctx.bucket).toBe("alice");
    expect(ctx.nodeTag).toBe("tag:p0rt1on-friend-alice");
  });

  it("counts live friends and excludes failed ones", async () => {
    const a = await repo.reserveFriend(
      makeAddInput("bob", "shared"),
      namingFor("bob", "shared"),
    );
    const b = await repo.reserveFriend(
      makeAddInput("carol", "shared"),
      namingFor("carol", "shared"),
    );
    expect(await repo.friendsOnInstance(a.instanceId)).toBe(2);

    await repo.markFailed(b.friendId);
    expect(await repo.friendsOnInstance(a.instanceId)).toBe(1);
  });

  it("context throws NOT_FOUND for an unknown friend", async () => {
    await expect(repo.context(999)).rejects.toThrow("not found");
  });

  it("deleteFriend removes the row", async () => {
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    await repo.deleteFriend(res.friendId);
    await expect(repo.context(res.friendId)).rejects.toThrow("not found");
  });

  it("deleteFriend drops child rows but keeps audit history (FK regression)", async () => {
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    // Child rows referencing friends.id. None have ON DELETE CASCADE, so
    // deleting the friend while these exist used to trip a FOREIGN KEY
    // constraint (the offboard bug).
    seedUsage(database.db, res.friendId, 100, 5, "2026-07-01T00:00:00Z");
    seedActivity(database.db, res.friendId, { requests24h: 7 });
    await repo.audit(res.friendId, "add_friend", "mode=dedicated");

    // Must not throw despite the referencing rows.
    await repo.deleteFriend(res.friendId);

    // Friend + its friend-scoped metric rows are gone...
    await expect(repo.context(res.friendId)).rejects.toThrow("not found");
    const usageCount = database.driver.prepare("SELECT COUNT(*) c FROM usage")
      .get();
    expect(usageCount?.c).toBe(0);
    const activityCount = database.driver.prepare(
      "SELECT COUNT(*) c FROM activity",
    ).get();
    expect(activityCount?.c).toBe(0);
    // ...but the audit trail survives, detached from the deleted friend.
    const auditCount = database.driver.prepare("SELECT COUNT(*) c FROM audit")
      .get();
    expect(auditCount?.c).toBe(1);
    const auditRow = database.driver.prepare("SELECT friend_id fid FROM audit")
      .get();
    expect(auditRow?.fid).toBeNull();
  });

  it("audit appends a row", async () => {
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    await repo.audit(res.friendId, "add_friend", "mode=dedicated");
    await repo.audit(null, "boot", undefined);

    const row = database.driver.prepare("SELECT COUNT(*) c FROM audit").get();
    expect(row?.c).toBe(2);
  });

  it("setQuota updates the friend's quota (no int64 truncation)", async () => {
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    await repo.setQuota(res.friendId, 30_000_000_000);

    const row = database.driver.prepare("SELECT quota_bytes q FROM friends")
      .get();
    expect(Number(row?.q)).toBe(30_000_000_000);
  });

  it("setStatus updates the friend's lifecycle status", async () => {
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    await repo.setStatus(res.friendId, "suspended");

    const row = database.driver.prepare("SELECT status s FROM friends").get();
    expect(row?.s).toBe("suspended");
  });

  it("deleteInstance frees the port for reuse", async () => {
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    await repo.deleteFriend(res.friendId);
    await repo.deleteInstance(res.instanceId);

    // With the instance gone, the next dedicated friend reclaims port 9000.
    const next = await repo.reserveFriend(
      makeAddInput("bob", "dedicated"),
      namingFor("bob", "dedicated"),
    );
    expect(next.hostPort).toBe(9000);
  });
});
