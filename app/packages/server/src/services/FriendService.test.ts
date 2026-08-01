import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FriendServiceImpl } from "./FriendService.ts";
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

describe("boot recovery → sweep (PRD 2.2, real SQLite)", () => {
  let database: Database;
  let repo: DrizzleProvisioningRepo;

  beforeEach(() => {
    database = createTestDatabase();
    repo = new DrizzleProvisioningRepo(database.db, TEST_REPO_CONFIG);
  });
  afterEach(() => database.driver.close());

  it("kill -9 mid-provision: next boot recovers, sweeps, and frees the name", async () => {
    // A crash between reserveFriend and markFailed leaves the row stuck in provisioning,
    // blocking the unique name with no recovery path.
    await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    await expect(repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    )).rejects.toThrow();

    // This runs against the real repo, with external teardown mocked, using explicit
    // delegation rather than a spread, since class methods live on the prototype and spreading would silently drop them.
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

    // The same name is reservable again after the sweep, confirming nothing was left orphaned.
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

  const build = (
    nodes: TailnetNode[] = [],
    serveMode: "https" | "http" = "https",
  ) => {
    const calls: string[] = [];
    const service = new FriendServiceImpl(
      queries,
      repo,
      mockMcFactory(mockMcClient(calls)),
      mockTailscaleApi(calls, nodes),
      serveMode,
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
    // In https mode the endpoint resolves the node's live MagicDNS FQDN; the mock returns <host>.tailnet.ts.net.
    expect(d.s3Endpoint).toBe("https://alice.tailnet.ts.net");
    expect(d.nodeOnline).toBe(true);
  });

  it("get: http serve mode yields an http endpoint (tailnet IP)", async () => {
    const res = await seed("alice");
    const { service } = build([], "http");
    const d = await service.get(res.friendId);
    // http mode addresses the node by tailnet IP, not the MagicDNS FQDN.
    expect(d.s3Endpoint).toBe("http://100.64.0.1");
  });

  it("get: throws when the serve node isn't on the tailnet yet (no domain fallback)", async () => {
    const res = await seed("alice");
    const calls: string[] = [];
    const service = new FriendServiceImpl(
      queries,
      repo,
      mockMcFactory(mockMcClient(calls)),
      // The node isn't registered, so nodeFqdn is null; with no composed guess, the error surfaces instead.
      { ...mockTailscaleApi(calls, []), nodeFqdn: () => Promise.resolve(null) },
      "https",
      noopLogger(),
    );
    await expect(service.get(res.friendId)).rejects.toThrow(
      "has no MagicDNS name yet",
    );
  });

  it("get: throws NOT_FOUND for an unknown friend", async () => {
    const { service } = build();
    await expect(service.get(999)).rejects.toThrow("not found");
  });

  it("suspend: throws NOT_FOUND for an unknown friend", async () => {
    const { service } = build();
    await expect(service.suspend(999)).rejects.toThrow("not found");
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
    const { service } = build([]);
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
      "https",
      noopLogger(),
    );

    await expect(service.suspend(res.friendId)).rejects.toThrow(
      "tailscale down",
    );
    // The user is disabled, then re-enabled after the failure, so access stays
    // open, matching a status that remains active.
    expect(calls).toContain("mc:disableUser");
    expect(calls.indexOf("mc:disableUser")).toBeLessThan(
      calls.indexOf("mc:enableUser"),
    );
    const d = await service.get(res.friendId);
    expect(d.status).toBe("active");

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
      "https",
      noopLogger(),
    );

    await expect(service.suspend(res.friendId)).rejects.toThrow("mc down");
    expect((await service.get(res.friendId)).status).toBe("active");
  });
});
