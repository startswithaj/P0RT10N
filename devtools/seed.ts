// Dev-only: seed a few friends (+ activity + usage) into a persistent DB so the
// dashboard has something to show. Bypasses the not-yet-wired provisioning flow
// by writing rows directly via the repo. Run: deno task seed
import { openDatabase } from "../app/packages/server/src/db/Database.ts";
import { runMigrations } from "../app/packages/server/src/db/MigrationRunner.ts";
import { DrizzleProvisioningRepo } from "../app/packages/server/src/db/ProvisioningRepo.ts";
import { activity, usage } from "../app/packages/server/src/db/Schema.ts";
import type { IsolationMode } from "../app/packages/shared/domain.ts";

const path = Deno.env.get("DB_PATH") ?? "./.p0rt1on-dev.db";
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
) {
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
}

await seed(
  "alice",
  "dedicated",
  30,
  18.3,
  1204,
  12,
  "2026-06-30T09:00:00Z",
  30,
);
await seed("bob", "shared", 50, 47, 9880, 0, "2026-06-24T09:00:00Z", 14);
await seed("carol", "shared", 10, 0.8, 40, 4, "2026-06-30T08:59:00Z", 14);

driver.close();
console.log(`Seeded 3 friends into ${path}`);
