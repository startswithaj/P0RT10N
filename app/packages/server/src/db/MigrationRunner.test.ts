import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { CompatDatabase } from "./SqliteCompat.ts";
import { applyMigrations, type MigrationEntry } from "./MigrationRunner.ts";

describe("applyMigrations", () => {
  // Synthetic fixtures, never the app's real migration files, so these tests
  // stay valid regardless of the generated schema.

  const good = (hash: string, table: string): MigrationEntry => ({
    hash,
    sql: [`CREATE TABLE ${table} (id INTEGER PRIMARY KEY)`],
    folderMillis: 1,
  });

  const broken: MigrationEntry = {
    hash: "m_broken",
    sql: [
      "CREATE TABLE b1 (id INTEGER PRIMARY KEY)",
      "CREATE TABLE b1 (id INTEGER PRIMARY KEY)", // Duplicate CREATE, so this statement throws.
      "CREATE TABLE b2 (id INTEGER PRIMARY KEY)",
    ],
    folderMillis: 2,
  };

  /** Same hash as `broken`, now with valid statements. */
  const repaired: MigrationEntry = {
    hash: "m_broken",
    sql: [
      "CREATE TABLE b1 (id INTEGER PRIMARY KEY)",
      "CREATE TABLE b2 (id INTEGER PRIMARY KEY)",
    ],
    folderMillis: 2,
  };

  let db: CompatDatabase;

  beforeEach(() => {
    db = new CompatDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  const journalHashes = () =>
    (db.prepare("SELECT hash FROM __drizzle_migrations").all() as {
      hash: string;
    }[]).map((r) => r.hash);

  const tableExists = (name: string) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name) !== undefined;

  it("applies pending migrations and journals them", () => {
    applyMigrations(db, [good("m1", "t1"), good("m2", "t2")]);
    expect(tableExists("t1")).toBe(true);
    expect(tableExists("t2")).toBe(true);
    expect(journalHashes()).toEqual(["m1", "m2"]);
  });

  it("rolls back a failing migration atomically and names it", () => {
    expect(() => applyMigrations(db, [broken])).toThrow(
      /m_broken.*statement 1/,
    );
    // None of its statements' effects persist, and no journal row exists.
    expect(tableExists("b1")).toBe(false);
    expect(journalHashes()).toEqual([]);
  });

  it("does not attempt later migrations after a failure", () => {
    expect(() =>
      applyMigrations(db, [good("m1", "t1"), broken, good("m3", "t3")])
    )
      .toThrow(/m_broken/);
    // The earlier good migration committed; the later one was never attempted.
    expect(journalHashes()).toEqual(["m1"]);
    expect(tableExists("t3")).toBe(false);
  });

  it("re-running after the fixture is repaired converges", () => {
    expect(() => applyMigrations(db, [broken])).toThrow();
    applyMigrations(db, [repaired]);
    expect(tableExists("b1")).toBe(true);
    expect(tableExists("b2")).toBe(true);
    expect(journalHashes()).toEqual(["m_broken"]);
  });

  it("runMigrations finds the real migration files regardless of CWD", async () => {
    const { runMigrations } = await import("./MigrationRunner.ts");
    const prev = Deno.cwd();
    const dir = Deno.makeTempDirSync();
    try {
      Deno.chdir(dir);
      runMigrations(db); // Throws if the migrations folder were still resolved relative to cwd.
      expect(journalHashes().length).toBeGreaterThan(0);
    } finally {
      Deno.chdir(prev);
      Deno.removeSync(dir, { recursive: true });
    }
  });

  it("skips already-applied migrations (journal respected)", () => {
    applyMigrations(db, [good("m1", "t1")]);
    // Same hash again, now with a conflicting statement, must be skipped rather than re-run.
    applyMigrations(db, [good("m1", "t1"), good("m2", "t2")]);
    expect(journalHashes()).toEqual(["m1", "m2"]);
  });
});
