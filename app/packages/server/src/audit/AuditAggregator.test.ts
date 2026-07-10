import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AuditAggregator } from "./AuditAggregator.ts";
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

describe("AuditAggregator", () => {
  let database: Database;
  let repo: DrizzleProvisioningRepo;
  let queries: FriendQueries;

  beforeEach(() => {
    database = createTestDatabase();
    repo = new DrizzleProvisioningRepo(database.db, TEST_REPO_CONFIG);
    queries = new FriendQueries(database.db);
  });
  afterEach(() => database.driver.close());

  // The friend's bucket-scoped S3 key; events must carry it to count (anything
  // else is the manager's own root-key polling and is dropped).
  const FRIEND_KEY = "FRIENDKEY000000000AB";

  const seed = async (name: string) => {
    const res = await repo.reserveFriend(
      makeAddInput(name, "dedicated"),
      namingFor(name, "dedicated"),
    );
    await repo.recordAccessKey(res.friendId, FRIEND_KEY);
    return res;
  };

  const agg = () => new AuditAggregator(database.db, noopLogger(), () => "T");

  it("folds events into the friend's activity (insert then update)", async () => {
    const res = await seed("alice");
    await agg().ingest({
      bucket: "alice",
      op: "PutObject",
      statusCode: 200,
      rx: 100,
      tx: 5,
      time: "2026-06-30T10:00:00Z",
      accessKey: FRIEND_KEY,
    });
    await agg().ingest({
      bucket: "alice",
      op: "GetObject",
      statusCode: 200,
      rx: 0,
      tx: 50,
      time: "2026-06-30T10:01:00Z",
      accessKey: FRIEND_KEY,
    });
    await agg().ingest({
      bucket: "alice",
      op: "PutObject",
      statusCode: 403,
      rx: 0,
      tx: 0,
      time: "2026-06-30T10:02:00Z",
      accessKey: FRIEND_KEY,
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

  it("ingestRaw parses MinIO's nested {api:{…}} format", async () => {
    const res = await seed("bob");
    await agg().ingestRaw({
      time: "2026-06-30T10:00:00Z",
      accessKey: FRIEND_KEY,
      api: { name: "PutObject", bucket: "bob", statusCode: 200, rx: 10, tx: 2 },
    });
    const act = await queries.activityFor(res.friendId);
    expect(act.requestsTotal).toBe(1);
    expect(act.requestsByOp.PutObject).toBe(1);
  });

  it("drops the manager's own polling (non-friend access key)", async () => {
    await seed("alice");
    // mc du/admin authenticates with the instance root key, not the friend's —
    // MinIO audits it back to us but it must not count as friend activity.
    await agg().ingest({
      bucket: "alice",
      op: "HeadBucket",
      statusCode: 200,
      rx: 0,
      tx: 0,
      time: "2026-06-30T10:00:00Z",
      accessKey: "ROOTKEY0000000000000",
    });

    const row = database.driver.prepare("SELECT COUNT(*) c FROM activity")
      .get();
    expect(row?.c).toBe(0);
  });

  it("counts ops under their raw MinIO name", async () => {
    const res = await seed("alice");
    await agg().ingest({
      bucket: "alice",
      op: "CompleteMultipartUpload",
      statusCode: 200,
      rx: 0,
      tx: 0,
      time: "2026-06-30T10:00:00Z",
      accessKey: FRIEND_KEY,
    });

    const act = await queries.activityFor(res.friendId);
    expect(act.requestsByOp.CompleteMultipartUpload).toBe(1);
    expect(act.lastOp).toBe("CompleteMultipartUpload");
  });

  it("counts 401 as denied", async () => {
    const res = await seed("alice");
    await agg().ingest({
      bucket: "alice",
      op: "GetObject",
      statusCode: 401,
      rx: 0,
      tx: 0,
      time: "2026-06-30T10:00:00Z",
      accessKey: FRIEND_KEY,
    });

    const act = await queries.activityFor(res.friendId);
    expect(act.deniedCount).toBe(1);
  });

  it("lastRequestAt is monotonic under out-of-order events", async () => {
    const res = await seed("alice");
    const newer = "2026-06-30T10:05:00Z";
    await agg().ingest({
      bucket: "alice",
      op: "PutObject",
      statusCode: 200,
      rx: 0,
      tx: 0,
      time: newer,
      accessKey: FRIEND_KEY,
    });
    // A back-dated event arrives after the newer one.
    await agg().ingest({
      bucket: "alice",
      op: "GetObject",
      statusCode: 200,
      rx: 0,
      tx: 0,
      time: "2026-06-30T10:00:00Z",
      accessKey: FRIEND_KEY,
    });

    const act = await queries.activityFor(res.friendId);
    expect(act.lastRequestAt).toBe(newer);
  });

  it("ignores unknown buckets and unparseable payloads", async () => {
    await agg().ingest({
      bucket: "ghost",
      op: "PutObject",
      statusCode: 200,
      rx: 0,
      tx: 0,
      time: "T",
      accessKey: FRIEND_KEY,
    });
    await agg().ingestRaw({ nonsense: true });

    const row = database.driver.prepare("SELECT COUNT(*) c FROM activity")
      .get();
    expect(row?.c).toBe(0);
  });
});
