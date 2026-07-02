import { type Database, type Db, openDatabase } from "../db/Database.ts";
import { runMigrations } from "../db/MigrationRunner.ts";
import { activity, usage } from "../db/Schema.ts";
import type { RepoConfig } from "../db/ProvisioningRepo.ts";
import type { FriendNaming } from "../provisioning/deps.ts";
import type { AddFriendInput, IsolationMode } from "@p0rt1on/shared/domain";

// ============================================================================
// In-memory test database. Applies the SAME generated Drizzle migrations the
// app runs at boot (no hand-written DDL) — one source of truth, no drift.
// ============================================================================

/** Open an in-memory DB with all migrations applied. Caller closes via `driver`. */
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

/** Mirrors ProvisioningService.buildNaming for repo-level tests. */
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
  };
}

/** Seed an activity row for a friend (rolling counters for the dashboard). */
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

/** Seed a point-in-time usage sample. Pass explicit checkedAt to order them. */
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
