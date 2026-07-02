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
import { hourKey } from "./audit/requestBuckets.ts";

describe("app wiring (tRPC caller over a real DB)", () => {
  const createCaller = createCallerFactory(appRouter);
  let database: Database;
  let caller: ReturnType<typeof createCaller>;
  let friendId: number;

  beforeEach(async () => {
    database = createTestDatabase();
    // Seed an active friend with activity + usage directly via the repo.
    const repo = new DrizzleProvisioningRepo(database.db, TEST_REPO_CONFIG);
    const res = await repo.reserveFriend(
      makeAddInput("alice", "dedicated"),
      namingFor("alice", "dedicated"),
    );
    friendId = res.friendId;
    await repo.activate(friendId, res.instanceId);
    // Bucket keyed to the current hour so it sits inside the rolling-24h window
    // the production clock (default) computes against.
    seedActivity(database.db, friendId, {
      lastRequestAt: "2026-06-29T09:00:00Z",
      requestBuckets: { [hourKey(new Date().toISOString())]: 7 },
    });
    seedUsage(database.db, friendId, 256, 4, "2026-06-29T09:00:00Z");

    caller = createCaller(buildContext(database, testEnv(), noopLogger()));
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
    // With a real mc factory + stub Tailscale (no binary/tailnet in unit tests),
    // these reach their service and fail at the external call — proving routing.
    // The service logic itself is covered in DbServices.test.ts with mocks.
    await expect(caller.friends.get({ friendId })).rejects.toThrow();
    await expect(
      caller.friends.add(makeAddInput("dave", "dedicated")),
    ).rejects.toThrow();
    await expect(caller.friends.resize({ friendId, quotaBytes: 2048 }))
      .rejects.toThrow();
    await expect(caller.friends.suspend({ friendId })).rejects.toThrow();
  });
});
