import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AuditServiceImpl } from "./AuditService.ts";
import { FriendQueries } from "../db/FriendQueries.ts";
import { DrizzleProvisioningRepo } from "../db/ProvisioningRepo.ts";
import type { Database } from "../db/Database.ts";
import {
  createTestDatabase,
  TEST_REPO_CONFIG,
} from "../test-helpers/testDb.ts";
import { noopLogger } from "../test-helpers/mocks.ts";

describe("AuditServiceImpl (real SQLite)", () => {
  let database: Database;
  let svc: AuditServiceImpl;

  beforeEach(() => {
    database = createTestDatabase();
    const repo = new DrizzleProvisioningRepo(
      database.db,
      TEST_REPO_CONFIG,
      noopLogger(),
    );
    svc = new AuditServiceImpl(new FriendQueries(database.db), repo);
  });
  afterEach(() => database.driver.close());

  it("record writes a system (null-friend) row that list returns newest-first", async () => {
    await svc.record("login");
    await svc.record("logout", "from the top nav");

    const rows = await svc.list(10);
    expect(rows.map((r) => r.action)).toEqual(["logout", "login"]);
    expect(rows[0].friend).toBe(null);
    // detail rides only on the row that carried one.
    expect(rows[0].detail).toBe("from the top nav");
    expect(rows[1].detail).toBe(null);
  });

  it("list honours the limit and the `before` id cursor", async () => {
    await svc.record("login");
    await svc.record("logout");

    const firstPage = await svc.list(1);
    expect(firstPage).toHaveLength(1);

    const older = await svc.list(10, firstPage[0].id);
    expect(older.map((r) => r.action)).toEqual(["login"]);
  });
});
