import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ActivityServiceImpl, FriendServiceImpl } from "./DbServices.ts";
import { FriendQueries } from "../db/FriendQueries.ts";
import { DrizzleProvisioningRepo } from "../db/ProvisioningRepo.ts";
import type { Database } from "../db/Database.ts";
import {
  createTestDatabase,
  makeAddInput,
  namingFor,
  TEST_REPO_CONFIG,
} from "../test-helpers/testDb.ts";
import {
  buildProvisioningService,
  type Calls,
  DEDICATED_RES,
  mockMcClient,
  mockMcFactory,
  mockTailscaleApi,
  noopLogger,
} from "../test-helpers/mocks.ts";
import type { TailnetNode } from "../tailscale/tailscale.ts";

describe("ActivityServiceImpl.stream", () => {
  it("throws NOT_IMPLEMENTED when iterated", () => {
    const database = createTestDatabase();
    const svc = new ActivityServiceImpl(new FriendQueries(database.db));
    const iterable = svc.stream(1, new AbortController().signal);
    expect(() => iterable[Symbol.asyncIterator]()).toThrow("not implemented");
    database.driver.close();
  });
});

describe("boot recovery → sweep (PRD 2.2, real SQLite)", () => {
  let database: Database;
  let repo: DrizzleProvisioningRepo;

  beforeEach(() => {
    database = createTestDatabase();
    repo = new DrizzleProvisioningRepo(database.db, TEST_REPO_CONFIG);
  });
  afterEach(() => database.driver.close());

  it("kill -9 mid-provision: next boot recovers, sweeps, and frees the name", async () => {
    // Crash between reserveFriend and markFailed: the row is stuck in
    // `provisioning` and the unique name is blocked with no recovery path.
    await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    await expect(repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    )).rejects.toThrow();

    // Boot sequence against the REAL repo (external teardown mocked): the
    // reservation fixture is unused — every repo call delegates to SQLite.
    // Explicit delegation (not a spread): class methods live on the prototype,
    // so spreading the repo instance into the mock would silently drop them.
    const calls: Calls = [];
    const svc = buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        failStaleProvisioning: () => repo.failStaleProvisioning(),
        failedFriendIds: () => repo.failedFriendIds(),
        failedInstances: () => repo.failedInstances(),
        context: (id) => repo.context(id),
        friendsOnInstance: (id) => repo.friendsOnInstance(id),
        deleteFriend: (id) => repo.deleteFriend(id),
        deleteInstance: (id) => repo.deleteInstance(id),
        audit: (f, a, d) => repo.audit(f, a, d),
      },
    });
    expect(await svc.recoverStaleProvisioning()).toEqual(["alice"]);
    expect(await svc.sweepFailed()).toBeGreaterThan(0);

    // Same boot, same name: reservable again — nothing orphaned.
    const again = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    expect(again.friendId).toBeGreaterThan(0);
  });
});

describe("FriendServiceImpl", () => {
  let database: Database;
  let repo: DrizzleProvisioningRepo;
  let queries: FriendQueries;

  beforeEach(() => {
    database = createTestDatabase();
    repo = new DrizzleProvisioningRepo(database.db, TEST_REPO_CONFIG);
    queries = new FriendQueries(database.db);
  });
  afterEach(() => database.driver.close());

  const build = (nodes: TailnetNode[] = []) => {
    const calls: string[] = [];
    const service = new FriendServiceImpl(
      queries,
      repo,
      mockMcFactory(mockMcClient(calls)),
      mockTailscaleApi(calls, nodes),
      "example.ts.net",
      noopLogger(),
    );
    return { calls, service };
  };

  const seed = async (name: string) => {
    const res = await repo.reserveFriend(
      makeAddInput(name, "dedicated"),
      namingFor(name, "dedicated"),
    );
    await repo.recordAccessKey(res.friendId, "AKIA1");
    await repo.activate(res.friendId, res.instanceId);
    return res;
  };

  it("get: builds detail with s3Endpoint + live nodeOnline", async () => {
    const res = await seed("alice");
    const { service } = build();
    const d = await service.get(res.friendId);
    expect(d.name).toBe("alice");
    expect(d.bucket).toBe("alice");
    expect(d.s3Endpoint).toBe("https://alice.example.ts.net");
    expect(d.nodeOnline).toBe(true);
  });

  it("get: throws NOT_FOUND for an unknown friend", async () => {
    const { service } = build();
    await expect(service.get(999)).rejects.toThrow("not found");
  });

  it("resize: sets the hard quota on mc, persists, returns fresh detail", async () => {
    const res = await seed("alice");
    const { calls, service } = build();
    const d = await service.resize(res.friendId, 5_000_000_000);
    expect(calls).toContain("mc:setHardQuota");
    expect(d.usage.quotaBytes).toBe(5_000_000_000);
  });

  it("suspend: disables the user, revokes nodes, flips status", async () => {
    const res = await seed("alice");
    const nodes: TailnetNode[] = [
      {
        nodeId: "n1",
        hostname: "alice",
        tags: ["tag:p0rt1on-friend-alice"],
        online: true,
      },
    ];
    const { calls, service } = build(nodes);
    const d = await service.suspend(res.friendId);
    expect(calls).toContain("mc:disableUser");
    expect(calls).toContain("ts:deleteNode:n1");
    expect(d.status).toBe("suspended");
  });

  it("resume: re-enables the user and flips status back to active", async () => {
    const res = await seed("alice");
    const { calls, service } = build();
    await service.suspend(res.friendId);
    const d = await service.resume(res.friendId);
    expect(calls).toContain("mc:enableUser");
    expect(d.status).toBe("active");
  });

  it("suspend with zero enrolled nodes succeeds (friend never connected)", async () => {
    const res = await seed("alice");
    const { service } = build([]); // nodesByTag → []
    const d = await service.suspend(res.friendId);
    expect(d.status).toBe("suspended");
  });

  it("state guards: suspend only from active, resume only from suspended", async () => {
    const res = await seed("alice");
    const { service } = build();

    await expect(service.resume(res.friendId)).rejects.toThrow(
      "cannot resume a active friend",
    );
    await repo.setStatus(res.friendId, "suspended");
    await expect(service.suspend(res.friendId)).rejects.toThrow(
      "cannot suspend a suspended friend",
    );
    await repo.setStatus(res.friendId, "failed");
    await expect(service.suspend(res.friendId)).rejects.toThrow(
      "cannot suspend a failed friend",
    );
    await repo.setStatus(res.friendId, "provisioning");
    await expect(service.suspend(res.friendId)).rejects.toThrow(
      "cannot suspend a provisioning friend",
    );
  });

  it("suspend compensates when node revoke fails: user re-enabled, stays active", async () => {
    const res = await seed("alice");
    const nodes: TailnetNode[] = [
      { nodeId: "n1", hostname: "alice", tags: [], online: true },
    ];
    const calls: string[] = [];
    const brokenTs = {
      ...mockTailscaleApi(calls, nodes),
      deleteNode: () => Promise.reject(new Error("tailscale down")),
    };
    const service = new FriendServiceImpl(
      queries,
      repo,
      mockMcFactory(mockMcClient(calls)),
      brokenTs,
      "example.ts.net",
      noopLogger(),
    );

    await expect(service.suspend(res.friendId)).rejects.toThrow(
      "tailscale down",
    );
    // Order: disabled, then re-enabled on the failure — access stays open,
    // matching the status that stays active.
    expect(calls).toContain("mc:disableUser");
    expect(calls.indexOf("mc:disableUser")).toBeLessThan(
      calls.indexOf("mc:enableUser"),
    );
    const d = await service.get(res.friendId);
    expect(d.status).toBe("active");

    // Retry with the API recovered converges to suspended.
    const { service: healthy } = build(nodes);
    const after = await healthy.suspend(res.friendId);
    expect(after.status).toBe("suspended");
  });

  it("suspend leaves status active when the S3 disable itself fails", async () => {
    const res = await seed("alice");
    const calls: string[] = [];
    const brokenMc = {
      ...mockMcClient(calls),
      disableUser: () => Promise.reject(new Error("mc down")),
    };
    const service = new FriendServiceImpl(
      queries,
      repo,
      mockMcFactory(brokenMc),
      mockTailscaleApi(calls),
      "example.ts.net",
      noopLogger(),
    );

    await expect(service.suspend(res.friendId)).rejects.toThrow("mc down");
    expect((await service.get(res.friendId)).status).toBe("active");
  });
});
