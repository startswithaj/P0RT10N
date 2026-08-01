// Dev-only: seeds friends with activity and usage data so the dashboard has
// something to show; bypasses the provisioning flow and writes rows directly
// via the repo.
import { openDatabase } from "../app/packages/server/src/db/Database.ts";
import { runMigrations } from "../app/packages/server/src/db/MigrationRunner.ts";
import { DrizzleProvisioningRepo } from "../app/packages/server/src/db/ProvisioningRepo.ts";
import {
  activity,
  audit,
  usage,
} from "../app/packages/server/src/db/Schema.ts";
import type { IsolationMode } from "../app/packages/shared/domain.ts";

const path = Deno.env.get("P0RT1ON_DB_PATH") ?? "./.p0rt1on-dev.db";
await Deno.remove(path).catch(() => {/* fresh start */});

const { db, driver } = openDatabase(path);
runMigrations(driver);
const repo = new DrizzleProvisioningRepo(db, {
  portRange: { min: 9100, max: 9999 },
  serveNodeTag: "tag:p0rt1on-serve",
});

const GB = 1_000_000_000;

async function seed(
  name: string,
  mode: IsolationMode,
  quotaGb: number,
  usedGb: number,
  objects: number,
  reqMin: number,
  lastReq: string,
  retention: number,
): Promise<number> {
  const res = await repo.reserveFriend(
    {
      name,
      quotaBytes: quotaGb * GB,
      retentionDays: retention,
      isolationMode: mode,
      lockMode: "GOVERNANCE",
    },
    {
      bucket: name,
      nodeTag: `tag:friend-${name}`,
      tsHostname: mode === "shared" ? "pool" : name,
    },
  );
  await repo.recordAccessKey(res.friendId, `AKIA${name.toUpperCase()}`);
  await repo.activate(res.friendId, res.instanceId);
  db.insert(activity).values({
    friendId: res.friendId,
    requestsTotal: 84_221,
    requests24h: reqMin,
    lastRequestAt: lastReq,
    bytesInTotal: usedGb * GB,
    deniedCount: 3,
  }).run();
  db.insert(usage).values({
    friendId: res.friendId,
    bytesUsed: Math.round(usedGb * GB),
    objectCount: objects,
    checkedAt: "2026-06-30T09:00:00Z",
  }).run();
  return res.friendId;
}

const alice = await seed(
  "alice",
  "dedicated",
  30,
  18.3,
  1204,
  12,
  "2026-06-30T09:00:00Z",
  30,
);
const bob = await seed(
  "bob",
  "shared",
  50,
  47,
  9880,
  0,
  "2026-06-24T09:00:00Z",
  14,
);
const carol = await seed(
  "carol",
  "shared",
  10,
  0.8,
  40,
  4,
  "2026-06-30T08:59:00Z",
  14,
);

// Lifecycle events so the Status-page "Recent events" panel isn't empty in
// dev; the seed bypasses the provisioning flow that writes these for real.
// Timestamps use SQLite's `datetime` format (space-separated, UTC).
db.insert(audit).values([
  {
    friendId: alice,
    friendName: "alice",
    action: "add_friend",
    detail: "mode=dedicated",
    createdAt: "2026-06-28 09:00:00",
  },
  {
    friendId: bob,
    friendName: "bob",
    action: "add_friend",
    detail: "mode=shared",
    createdAt: "2026-06-24 09:05:00",
  },
  {
    friendId: carol,
    friendName: "carol",
    action: "add_friend",
    detail: "mode=shared",
    createdAt: "2026-06-24 09:06:00",
  },
  {
    friendId: alice,
    friendName: "alice",
    action: "resize",
    detail: "quotaBytes=32212254720",
    createdAt: "2026-06-29 14:30:00",
  },
  {
    friendId: carol,
    friendName: "carol",
    action: "suspend",
    detail: null,
    createdAt: "2026-06-30 08:00:00",
  },
  {
    friendId: null,
    friendName: null,
    action: "instance_recovered",
    detail: "p0rt1on-alice recreated over surviving data",
    createdAt: "2026-07-01 06:15:00",
  },
]).run();

driver.close();
console.log(`Seeded 3 friends (+ audit events) into ${path}`);
