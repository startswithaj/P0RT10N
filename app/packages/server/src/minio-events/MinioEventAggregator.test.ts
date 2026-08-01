import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { MinioEventAggregator } from "./MinioEventAggregator.ts";
import {
  type MinioEventSubscription,
  subscription,
} from "./MinioEventSubscription.ts";
import type { FriendEvent } from "./resolveFriend.ts";
import type { MinioEvent } from "./parseMinioEvent.ts";
import { FriendQueries } from "../db/FriendQueries.ts";
import { DrizzleProvisioningRepo } from "../db/ProvisioningRepo.ts";
import type { Database } from "../db/Database.ts";
import {
  createTestDatabase,
  makeAddInput,
  namingFor,
  TEST_REPO_CONFIG,
} from "../test-helpers/testDb.ts";
import { noopLogger } from "../test-helpers/mocks.ts";

describe("MinioEventAggregator", () => {
  let database: Database;
  let repo: DrizzleProvisioningRepo;
  let queries: FriendQueries;

  beforeEach(() => {
    database = createTestDatabase();
    repo = new DrizzleProvisioningRepo(database.db, TEST_REPO_CONFIG);
    queries = new FriendQueries(database.db);
  });
  afterEach(() => database.driver.close());

  const FRIEND_KEY = "FRIENDKEY000000000AB";

  const seed = async (name: string) => {
    const res = await repo.reserveFriend(
      makeAddInput(name, "dedicated"),
      namingFor(name, "dedicated"),
    );
    await repo.recordAccessKey(res.friendId, FRIEND_KEY);
    return res;
  };

  // fold() never reads the stream itself, so these tests can pass an empty one.
  // accessKey is irrelevant here, kept only to satisfy the MinioEvent shape.
  const emptyStream = (): MinioEventSubscription<FriendEvent> =>
    subscription(
      (async function* (): AsyncGenerator<FriendEvent> {})(),
      new AbortController().signal,
    );

  const agg = () =>
    new MinioEventAggregator(
      emptyStream(),
      database.db,
      noopLogger(),
      () => "T",
    );

  const ev = (over: Partial<MinioEvent>): MinioEvent => ({
    bucket: "alice",
    op: "PutObject",
    statusCode: 200,
    rx: 0,
    tx: 0,
    time: "2026-06-30T10:00:00Z",
    accessKey: FRIEND_KEY,
    ...over,
  });

  it("folds events into the friend's activity (insert then update)", async () => {
    const res = await seed("alice");
    await agg().fold({
      event: ev({ op: "PutObject", rx: 100, tx: 5 }),
      friendId: res.friendId,
    });
    await agg().fold({
      event: ev({ op: "GetObject", tx: 50, time: "2026-06-30T10:01:00Z" }),
      friendId: res.friendId,
    });
    await agg().fold({
      event: ev({ statusCode: 403, time: "2026-06-30T10:02:00Z" }),
      friendId: res.friendId,
    });

    const act = await queries.activityFor(res.friendId);
    expect(act.requestsTotal).toBe(3);
    expect(act.requestsByOp.PutObject).toBe(2);
    expect(act.requestsByOp.GetObject).toBe(1);
    expect(act.bytesInTotal).toBe(100);
    expect(act.bytesOutTotal).toBe(55);
    expect(act.deniedCount).toBe(1);
    expect(act.lastOp).toBe("PutObject");
    expect(act.lastRequestAt).toBe("2026-06-30T10:02:00Z");
  });

  it("counts 401 as denied", async () => {
    const res = await seed("alice");
    await agg().fold({
      event: ev({ op: "GetObject", statusCode: 401 }),
      friendId: res.friendId,
    });
    const act = await queries.activityFor(res.friendId);
    expect(act.deniedCount).toBe(1);
  });

  it("counts ops under their raw MinIO name", async () => {
    const res = await seed("alice");
    await agg().fold({
      event: ev({ op: "CompleteMultipartUpload" }),
      friendId: res.friendId,
    });
    const act = await queries.activityFor(res.friendId);
    expect(act.requestsByOp.CompleteMultipartUpload).toBe(1);
    expect(act.lastOp).toBe("CompleteMultipartUpload");
  });

  it("lastRequestAt is monotonic under out-of-order events", async () => {
    const res = await seed("alice");
    const newer = "2026-06-30T10:05:00Z";
    await agg().fold({ event: ev({ time: newer }), friendId: res.friendId });
    // A back-dated event arrives after the newer one.
    await agg().fold({
      event: ev({ op: "GetObject", time: "2026-06-30T10:00:00Z" }),
      friendId: res.friendId,
    });
    const act = await queries.activityFor(res.friendId);
    expect(act.lastRequestAt).toBe(newer);
  });

  it("run folds every resolved event on the stream until it ends", async () => {
    const res = await seed("alice");

    async function* events(): AsyncGenerator<FriendEvent> {
      yield { event: ev({ op: "PutObject", rx: 3 }), friendId: res.friendId };
      yield {
        event: ev({ op: "GetObject", tx: 7, time: "2026-06-30T10:01:00Z" }),
        friendId: res.friendId,
      };
    }

    // Constructing starts the fold loop; `done` resolves when the stream ends.
    await new MinioEventAggregator(
      subscription(events(), new AbortController().signal),
      database.db,
      noopLogger(),
      () => "T",
    ).done;

    const act = await queries.activityFor(res.friendId);
    expect(act.requestsTotal).toBe(2);
    expect(act.requestsByOp.PutObject).toBe(1);
    expect(act.requestsByOp.GetObject).toBe(1);
    expect(act.bytesInTotal).toBe(3);
    expect(act.bytesOutTotal).toBe(7);
  });

  it("a mid-stream error stops the consumer, logged — done never rejects", async () => {
    const errors: string[] = [];
    const logger = {
      ...noopLogger(),
      error: (m: string) => void errors.push(m),
    };

    const boom: AsyncIterable<FriendEvent> = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error("stream broke")),
      }),
    };

    await new MinioEventAggregator(
      subscription(boom, new AbortController().signal),
      database.db,
      logger,
      () => "T",
    ).done; // `done` resolves even though the stream rejected.
    expect(errors.some((m) => m.includes("aggregator stopped"))).toBe(true);
  });
});
