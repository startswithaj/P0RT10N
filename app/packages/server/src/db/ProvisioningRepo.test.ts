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

  it("skips a port a foreign process holds (probe says busy)", async () => {
    // The DB thinks 9000 is free, but something else is bound to it, so the
    // probe must advance to 9001 instead of failing on 9000 forever.
    const probed = new DrizzleProvisioningRepo(database.db, {
      ...TEST_REPO_CONFIG,
      probePort: (port) => port !== 9000,
    });
    const res = await probed.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    expect(res.hostPort).toBe(9001);
  });

  it("throws CONFLICT when every DB-free port probes busy", async () => {
    const probed = new DrizzleProvisioningRepo(database.db, {
      ...TEST_REPO_CONFIG,
      probePort: () => false,
    });
    await expect(
      probed.reserveFriend(
        makeAddInput("alice", "dedicated"),
        namingFor("alice", "dedicated"),
      ),
    ).rejects.toThrow("no free MinIO port");
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

  it("liveFriendTagsOnInstance returns each non-failed friend's node tag", async () => {
    const bob = await repo.reserveFriend(
      makeAddInput("bob", "shared"),
      namingFor("bob", "shared"),
    );
    await repo.reserveFriend(
      makeAddInput("carol", "shared"),
      namingFor("carol", "shared"),
    );
    // Both are pooled onto one instance; recovery re-applies both grants.
    const tags = await repo.liveFriendTagsOnInstance(bob.instanceId);
    expect(tags.toSorted()).toEqual([
      "tag:p0rt1on-friend-bob",
      "tag:p0rt1on-friend-carol",
    ]);
  });

  it("shared: never adopts a reaping instance — a new pool is created instead", async () => {
    // Reap-vs-add race: once marked `reaping`, a concurrent add must not
    // reserve onto it, since `instanceExisted: true` would skip container start.
    const bob = await repo.reserveFriend(
      makeAddInput("bob", "shared"),
      namingFor("bob", "shared"),
    );
    await repo.deleteFriend(bob.friendId);
    expect(
      await repo.markInstanceReaping(bob.instanceId, { requireEmpty: true }),
    ).toBe(true);

    const carol = await repo.reserveFriend(
      makeAddInput("carol", "shared"),
      namingFor("carol", "shared"),
    );
    expect(carol.instanceExisted).toBe(false);
    expect(carol.instanceId).not.toBe(bob.instanceId);
  });

  it("markInstanceReaping refuses while live friends remain (requireEmpty)", async () => {
    const bob = await repo.reserveFriend(
      makeAddInput("bob", "shared"),
      namingFor("bob", "shared"),
    );
    expect(
      await repo.markInstanceReaping(bob.instanceId, { requireEmpty: true }),
    ).toBe(false);
    // Dedicated teardown does not require empty, since the offboarding
    // friend's own row may still exist when the mark happens.
    expect(
      await repo.markInstanceReaping(bob.instanceId, { requireEmpty: false }),
    ).toBe(true);
  });

  it("shared: adopting an existing pool returns its STORED hostname, not config's", async () => {
    await repo.reserveFriend(
      makeAddInput("bob", "shared"),
      namingFor("bob", "shared", "pool"),
    );
    const carol = await repo.reserveFriend(
      makeAddInput("carol", "shared"),
      namingFor("carol", "shared", "renamed-pool"),
    );

    expect(carol.instanceExisted).toBe(true);
    expect(carol.tsHostname).toBe("pool"); // the endpoint that actually exists
    expect(carol.alias).toBe("pool");
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
    expect(ctx.serveNodeId).toBeNull();
  });

  it("records the serve node ID; context reflects it", async () => {
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    await repo.recordServeNodeId(res.instanceId, "srv-node-1");

    const ctx = await repo.context(res.friendId);
    expect(ctx.serveNodeId).toBe("srv-node-1");
  });

  it("recordInvite flips the friend to invite mode; context reflects it", async () => {
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    const before = await repo.context(res.friendId);
    expect(before.enrollmentMode).toBe("authKey");
    expect(before.inviteEmail).toBeNull();

    await repo.recordInvite(res.friendId, {
      email: "bob@example.com",
      inviteId: "inv1",
      status: "pending",
    });

    const ctx = await repo.context(res.friendId);
    expect(ctx.enrollmentMode).toBe("invite");
    expect(ctx.inviteEmail).toBe("bob@example.com");
    expect(ctx.inviteId).toBe("inv1");
  });

  it("otherFriendsWithInviteEmail counts sharers, excluding self", async () => {
    const alice = await repo.reserveFriend(
      makeAddInput("alice", "shared"),
      namingFor("alice", "shared"),
    );
    const bob = await repo.reserveFriend(
      makeAddInput("bob", "shared"),
      namingFor("bob", "shared"),
    );
    const email = "friend@example.com";
    await repo.recordInvite(alice.friendId, {
      email,
      inviteId: "i1",
      status: "pending",
    });
    await repo.recordInvite(bob.friendId, {
      email,
      inviteId: "i2",
      status: "pending",
    });

    expect(await repo.otherFriendsWithInviteEmail(alice.friendId, email)).toBe(
      1,
    );
    expect(await repo.otherFriendsWithInviteEmail(alice.friendId, "x@y.z"))
      .toBe(0);
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
    // None of these child rows have ON DELETE CASCADE, so deleting the friend
    // while they exist used to trip a foreign key constraint (the offboard bug).
    seedUsage(database.db, res.friendId, 100, 5, "2026-07-01T00:00:00Z");
    seedActivity(database.db, res.friendId, { requests24h: 7 });
    await repo.audit(res.friendId, "add_friend", "mode=dedicated");

    await repo.deleteFriend(res.friendId);

    await expect(repo.context(res.friendId)).rejects.toThrow("not found");
    const usageCount = database.driver.prepare("SELECT COUNT(*) c FROM usage")
      .get();
    expect(usageCount?.c).toBe(0);
    const activityCount = database.driver.prepare(
      "SELECT COUNT(*) c FROM activity",
    ).get();
    expect(activityCount?.c).toBe(0);
    // The audit trail survives, detached from the deleted friend.
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
    await repo.audit(null, "instance_data_lost", undefined);

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

  it("failStaleProvisioning fails crashed provisions (friend + empty instance)", async () => {
    // Simulate a crash between reserveFriend and markFailed: the row is left
    // in `provisioning` with no in-process catch to recover it.
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );

    const names = await repo.failStaleProvisioning();

    expect(names).toEqual(["alice"]);
    const friendRow = database.driver
      .prepare("SELECT status s FROM friends").get();
    expect(friendRow?.s).toBe("failed");
    const instanceRow = database.driver
      .prepare("SELECT status s FROM instances").get();
    expect(instanceRow?.s).toBe("failed");
    // The failed tombstones are now visible to the sweep.
    expect(await repo.failedFriendIds()).toEqual([res.friendId]);
  });

  it("failStaleProvisioning leaves active and failed rows untouched", async () => {
    const active = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    await repo.activate(active.friendId, active.instanceId);
    const failed = await repo.reserveFriend(
      makeAddInput("bob", "dedicated"),
      namingFor("bob", "dedicated"),
    );
    await repo.markFailed(failed.friendId);

    expect(await repo.failStaleProvisioning()).toEqual([]);

    const statuses = database.driver
      .prepare("SELECT name n, status s FROM friends ORDER BY name").all();
    expect(statuses).toEqual([
      { n: "alice", s: "active" },
      { n: "bob", s: "failed" },
    ]);
  });

  it("failStaleProvisioning keeps a shared instance alive for surviving friends", async () => {
    // bob is active on the shared pool; carol crashed mid-provision. Failing
    // carol must NOT fail the instance bob still lives on (markFailed parity).
    const bob = await repo.reserveFriend(
      makeAddInput("bob", "shared"),
      namingFor("bob", "shared"),
    );
    await repo.activate(bob.friendId, bob.instanceId);
    await repo.reserveFriend(
      makeAddInput("carol", "shared"),
      namingFor("carol", "shared"),
    );

    expect(await repo.failStaleProvisioning()).toEqual(["carol"]);

    const instanceRow = database.driver
      .prepare("SELECT status s FROM instances").get();
    expect(instanceRow?.s).toBe("active");
  });

  it("liveInstances lists non-failed; failInstanceMissing fails instance + friends", async () => {
    const bob = await repo.reserveFriend(
      makeAddInput("bob", "shared"),
      namingFor("bob", "shared"),
    );
    await repo.activate(bob.friendId, bob.instanceId);
    const carol = await repo.reserveFriend(
      makeAddInput("carol", "shared"),
      namingFor("carol", "shared"),
    );
    await repo.activate(carol.friendId, carol.instanceId);

    const live = await repo.liveInstances();
    expect(live.length).toBe(1);
    expect(live[0].instanceId).toBe(bob.instanceId);
    expect(live[0].minioPort).toBe(9000);

    // The container vanished, so both friends and the instance flip in one call.
    expect(await repo.failInstanceMissing(bob.instanceId)).toBe(2);
    expect(await repo.liveInstances()).toEqual([]);
    expect((await repo.failedFriendIds()).length).toBe(2);
    // Repeating the call is a no-op, since everything is already failed.
    expect(await repo.failInstanceMissing(bob.instanceId)).toBe(0);
  });

  it("activate is atomic: a failure on the instance update rolls back the friend update", async () => {
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    // Inject a failure between the two statements: the friend update runs
    // first, then the instance update trips this trigger.
    database.driver.exec(
      `CREATE TRIGGER inject_fail BEFORE UPDATE ON instances
       BEGIN SELECT RAISE(ABORT, 'injected'); END`,
    );

    await expect(repo.activate(res.friendId, res.instanceId)).rejects
      .toThrow("injected");

    const row = database.driver.prepare("SELECT status s FROM friends").get();
    expect(row?.s).toBe("provisioning");
  });

  it("markFailed is atomic: a failure on the instance update rolls back the friend update", async () => {
    // A lone dedicated friend, so failFriendRow also fails the instance row.
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    database.driver.exec(
      `CREATE TRIGGER inject_fail BEFORE UPDATE ON instances
       BEGIN SELECT RAISE(ABORT, 'injected'); END`,
    );

    await expect(repo.markFailed(res.friendId)).rejects.toThrow("injected");

    const row = database.driver.prepare("SELECT status s FROM friends").get();
    expect(row?.s).toBe("provisioning");
  });

  it("deleteInstance frees the port for reuse", async () => {
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    await repo.deleteFriend(res.friendId);
    await repo.deleteInstance(res.instanceId);

    const next = await repo.reserveFriend(
      makeAddInput("bob", "dedicated"),
      namingFor("bob", "dedicated"),
    );
    expect(next.hostPort).toBe(9000);
  });
});
