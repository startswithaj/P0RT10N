import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildContext } from "./app.ts";
import { appRouter } from "./trpc/root.ts";
import { createCallerFactory } from "./trpc/trpc.ts";
import { DrizzleProvisioningRepo } from "./db/ProvisioningRepo.ts";
import type { Database } from "./db/Database.ts";
import { noopLogger, testEnv } from "./test-helpers/mocks.ts";
import {
  createTestDatabase,
  makeAddInput,
  namingFor,
  seedActivity,
  seedUsage,
  TEST_REPO_CONFIG,
} from "./test-helpers/testDb.ts";
import { hourKey } from "./minio-events/requestBuckets.ts";

describe("app wiring (tRPC caller over a real DB)", () => {
  const createCaller = createCallerFactory(appRouter);
  let database: Database;
  let caller: ReturnType<typeof createCaller>;
  let friendId: number;

  beforeEach(async () => {
    database = createTestDatabase();
    const repo = new DrizzleProvisioningRepo(database.db, TEST_REPO_CONFIG);
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    friendId = res.friendId;
    await repo.activate(friendId, res.instanceId);
    // The bucket is keyed to the current hour so it falls inside the rolling
    // 24-hour window that the production clock computes against.
    seedActivity(database.db, friendId, {
      lastRequestAt: "2026-06-29T09:00:00Z",
      requestBuckets: { [hourKey(new Date().toISOString())]: 7 },
    });
    seedUsage(database.db, friendId, 256, 4, "2026-06-29T09:00:00Z");

    caller = createCaller(
      await buildContext(database, testEnv(), noopLogger()),
    );
  });

  afterEach(() => {
    database.driver.close();
  });

  it("friends.list returns DB-backed rows", async () => {
    const list = await caller.friends.list();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("alice");
    expect(list[0].usage.bytesUsed).toBe(256);
    expect(list[0].requests24h).toBe(7);
  });

  it("usage.history returns samples", async () => {
    const history = await caller.usage.history({ friendId, limit: 10 });
    expect(history.length).toBe(1);
    expect(history[0].bytesUsed).toBe(256);
  });

  it("activity.current returns the aggregate", async () => {
    const activity = await caller.activity.current({ friendId });
    expect(activity.requests24h).toBe(7);
    expect(activity.lastRequestAt).toBe("2026-06-29T09:00:00Z");
  });

  it("management mutations are wired (reject at the external boundary)", async () => {
    // With a real mc factory and a stub Tailscale (no binary in unit tests), these calls
    // reach their service and fail at the external boundary; the service logic itself is covered by mocks in FriendService.test.ts.
    // Tailscale reads hit the real HTTP client with a bogus test token, so these
    // fail at the network/API boundary (401), not on validation or a missing mock.
    await expect(caller.friends.get({ friendId })).rejects.toThrow(
      "tailscale GET /tailnet/-/devices failed (401)",
    );
    await expect(
      caller.friends.add(makeAddInput("dave", "dedicated")),
      // confirmHostname's device lookup now runs before the ACL step, so
      // that's the first real Tailscale call this reaches and fails on.
    ).rejects.toThrow("tailscale GET /tailnet/-/devices failed (401)");
    // resize hits mc first, which has no binary in the unit env.
    await expect(caller.friends.resize({ friendId, quotaBytes: 2048 }))
      .rejects.toThrow("Failed to spawn 'mc'");
    await expect(caller.friends.suspend({ friendId })).rejects.toThrow(
      "tailscale GET /tailnet/-/devices failed (401)",
    );
  });

  // Mutations start detached work that fails at the external boundary in the unit env (no mc/docker).
  // That failure must arrive as a terminal error event, never a hang or a stream throw, since preventing that bug class is why the job model exists.

  it("addStart detaches the job; failure arrives as an error event via jobs.progress", async () => {
    const { jobId } = await caller.friends.addStart(
      makeAddInput("dave", "dedicated"),
    );
    const events = await Array.fromAsync(await caller.jobs.progress({ jobId }));
    expect(events.at(-1)?.type).toBe("error");
    // A failed add produces no bundle; the claim maps a NotFoundError to a TRPC NOT_FOUND error.
    await expect(caller.jobs.claimBundle({ jobId })).rejects.toThrow(
      "none produced",
    );
  });

  it("offboardStart returns a jobId whose progress stream terminates", async () => {
    const { jobId } = await caller.friends.offboardStart({ friendId });
    const events = await Array.fromAsync(await caller.jobs.progress({ jobId }));
    expect(["done", "error"]).toContain(events.at(-1)?.type);
  });

  it("jobs.progress yields a renderable error event for an unknown job id", async () => {
    const events = await Array.fromAsync(
      await caller.jobs.progress({ jobId: crypto.randomUUID() }),
    );
    expect(events).toEqual([{
      type: "error",
      message: "job not found (expired or manager restarted)",
      step: null,
    }]);
  });
});
