import { type Database, type Db, openDatabase } from "../db/Database.ts";
import { runMigrations } from "../db/MigrationRunner.ts";
import { activity, usage } from "../db/Schema.ts";
import type { RepoConfig } from "../db/ProvisioningRepo.ts";
import type { FriendNaming } from "../provisioning/deps.ts";
import type { AddFriendInput, IsolationMode } from "@p0rt1on/shared/domain";

// Applies the same generated Drizzle migrations the app runs at boot, with no
// hand-written DDL, so there is a single source of truth and no drift.

/** Caller closes via `driver`. */
export function createTestDatabase(): Database {
  const database = openDatabase(":memory:");
  runMigrations(database.driver);
  return database;
}

/** A RepoConfig with a small port range for deterministic allocation tests. */
export const TEST_REPO_CONFIG: RepoConfig = {
  portRange: { min: 9000, max: 9002 },
  serveNodeTag: "tag:p0rt1on-serve",
};

export function namingFor(
  name: string,
  isolationMode: IsolationMode,
  sharedHostname = "pool",
): FriendNaming {
  return {
    bucket: name,
    nodeTag: `tag:p0rt1on-friend-${name}`,
    tsHostname: isolationMode === "shared" ? sharedHostname : name,
  };
}

export function makeAddInput(
  name: string,
  isolationMode: IsolationMode,
): AddFriendInput {
  return {
    name,
    quotaBytes: 1024,
    retentionDays: 30,
    isolationMode,
    lockMode: "GOVERNANCE",
    enrollment: { mode: "authKey" },
  };
}

export function seedActivity(
  db: Db,
  friendId: number,
  fields: {
    requests24h?: number;
    lastRequestAt?: string;
    requestBuckets?: Record<string, number>;
  },
): void {
  db.insert(activity).values({ friendId, ...fields }).run();
}

/** Pass an explicit `checkedAt` so seeded samples can be ordered deterministically. */
export function seedUsage(
  db: Db,
  friendId: number,
  bytesUsed: number,
  objectCount: number,
  checkedAt: string,
): void {
  db.insert(usage).values({ friendId, bytesUsed, objectCount, checkedAt })
    .run();
}
