import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FriendQueries } from "./FriendQueries.ts";
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
import { hourKey } from "../audit/requestBuckets.ts";

describe("FriendQueries", () => {
  // Fixed "now" so the rolling-24h window is deterministic; the seeded buckets
  // below sit just inside it.
  const NOW = "2026-06-29T09:30:00Z";
  let database: Database;
  let repo: DrizzleProvisioningRepo;
  let queries: FriendQueries;

  beforeEach(() => {
    database = createTestDatabase();
    repo = new DrizzleProvisioningRepo(database.db, TEST_REPO_CONFIG);
    queries = new FriendQueries(database.db, () => NOW);
  });

  afterEach(() => {
    database.driver.close();
  });

  const addFriend = (name: string) =>
    repo.reserveFriend(
      makeAddInput(name, "dedicated"),
      namingFor(name, "dedicated"),
    );

  it("list: reflects the newest usage sample and rolling activity", async () => {
    const res = await addFriend("alice");
    seedActivity(database.db, res.friendId, {
      lastRequestAt: "2026-06-29T09:00:00Z",
      requestBuckets: { [hourKey("2026-06-29T09:00:00Z")]: 12 },
    });
    seedUsage(database.db, res.friendId, 100, 5, "2026-06-29T08:00:00Z");
    seedUsage(database.db, res.friendId, 512, 9, "2026-06-29T09:00:00Z"); // newest

    const list = await queries.list();
    expect(list.length).toBe(1);
    const row = list[0];
    expect(row.name).toBe("alice");
    expect(row.requests24h).toBe(12);
    expect(row.usage.bytesUsed).toBe(512); // newest sample wins
    expect(row.usage.objectCount).toBe(9);
    expect(row.usage.quotaBytes).toBe(1024);
    expect(row.usage.fraction).toBeCloseTo(0.5);
  });

  it("list: a friend with no activity/usage gets zeroed defaults", async () => {
    await addFriend("bob");

    const list = await queries.list();
    expect(list[0].requests24h).toBe(0);
    expect(list[0].lastRequestAt).toBeNull();
    expect(list[0].usage.bytesUsed).toBe(0);
    expect(list[0].usage.fraction).toBe(0);
    expect(list[0].usage.checkedAt).toBeNull();
  });

  it("usageHistory: newest first, respecting the limit", async () => {
    const res = await addFriend("carol");
    seedUsage(database.db, res.friendId, 10, 1, "2026-06-29T07:00:00Z");
    seedUsage(database.db, res.friendId, 20, 2, "2026-06-29T08:00:00Z");
    seedUsage(database.db, res.friendId, 30, 3, "2026-06-29T09:00:00Z");

    const history = await queries.usageHistory(res.friendId, 2);
    expect(history.length).toBe(2);
    expect(history[0].bytesUsed).toBe(30); // newest
    expect(history[1].bytesUsed).toBe(20);
  });

  it("usageHistory: unknown friend returns empty", async () => {
    expect(await queries.usageHistory(999, 10)).toEqual([]);
  });

  it("detail: joins friend + instance + newest usage + activity", async () => {
    const res = await addFriend("alice");
    await repo.recordAccessKey(res.friendId, "AKIA1");
    seedActivity(database.db, res.friendId, {
      lastRequestAt: "2026-06-29T09:00:00Z",
      requestBuckets: { [hourKey("2026-06-29T09:00:00Z")]: 7 },
    });
    seedUsage(database.db, res.friendId, 100, 2, "2026-06-29T07:00:00Z");
    seedUsage(database.db, res.friendId, 256, 3, "2026-06-29T09:00:00Z"); // newest

    const d = await queries.detail(res.friendId);
    expect(d?.name).toBe("alice");
    expect(d?.bucket).toBe("alice");
    expect(d?.s3AccessKeyId).toBe("AKIA1");
    expect(d?.tsNodeTag).toBe("tag:p0rt1on-friend-alice");
    expect(d?.instanceKind).toBe("dedicated");
    expect(d?.tsHostname).toBe("alice");
    expect(d?.usage.bytesUsed).toBe(256); // newest sample wins
    expect(d?.usage.quotaBytes).toBe(1024);
    expect(d?.activity.requests24h).toBe(7);
  });

  it("detail: returns null for an unknown friend", async () => {
    expect(await queries.detail(999)).toBeNull();
  });

  it("pruneUsage deletes only samples older than the retention cutoff", async () => {
    const res = await addFriend("alice");
    // NOW is 2026-06-29; the 90-day cutoff falls on 2026-03-31.
    seedUsage(database.db, res.friendId, 100, 1, "2026-03-01T00:00:00Z"); // stale
    seedUsage(database.db, res.friendId, 200, 2, "2026-06-01T00:00:00Z"); // kept
    seedUsage(database.db, res.friendId, 300, 3, "2026-06-29T09:00:00Z"); // kept

    expect(await queries.pruneUsage()).toBe(1);

    const remaining = database.driver
      .prepare("SELECT checked_at c FROM usage ORDER BY checked_at").all();
    expect(remaining.map((r) => r.c)).toEqual([
      "2026-06-01T00:00:00Z",
      "2026-06-29T09:00:00Z",
    ]);
    // The latest sample still surfaces on the dashboard.
    const list = await queries.list();
    expect(list[0].usage.bytesUsed).toBe(300);
  });
});
