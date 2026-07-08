import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { CompatDatabase } from "./SqliteCompat.ts";

describe("CompatDatabase", () => {
  let db: CompatDatabase;

  beforeEach(() => {
    db = new CompatDatabase(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
  });

  afterEach(() => {
    db.close();
  });

  const insert = (v: string) =>
    db.prepare("INSERT INTO t (v) VALUES (?)").run(v);

  it("run() reports changes + lastInsertRowid", () => {
    const r = insert("a");
    expect(r.changes).toBe(1);
    expect(r.lastInsertRowid).toBe(1);
  });

  it("all() and get() return objects", () => {
    insert("a");
    insert("b");
    expect(db.prepare("SELECT * FROM t").all().length).toBe(2);
    const one = db.prepare("SELECT v FROM t WHERE id = ?").get(1);
    expect(one?.v).toBe("a");
  });

  it("raw().all() and raw().get() return tuples", () => {
    insert("a");
    const rawAll = db.prepare("SELECT v FROM t").raw().all();
    expect(rawAll[0][0]).toBe("a");
    const rawGet = db.prepare("SELECT v FROM t").raw().get();
    expect(rawGet?.[0]).toBe("a");
    const rawEmpty = db.prepare("SELECT v FROM t WHERE id = 999").raw().get();
    expect(rawEmpty).toBeUndefined();
  });

  it("transaction deferred/immediate/exclusive each commit", () => {
    const tx = db.transaction(() => {
      insert("x");
      return "ok";
    });
    expect(tx.deferred(null)).toBe("ok");
    expect(tx.immediate(null)).toBe("ok");
    expect(tx.exclusive(null)).toBe("ok");
    expect(db.prepare("SELECT COUNT(*) c FROM t").get()?.c).toBe(3);
  });

  it("transaction rolls back on throw", () => {
    const bad = db.transaction(() => {
      insert("y");
      throw new Error("boom");
    });
    expect(() => bad.deferred(null)).toThrow("boom");
    expect(db.prepare("SELECT COUNT(*) c FROM t").get()?.c).toBe(0);
  });

  it("opens with WAL and busy_timeout set", () => {
    // WAL needs a file-backed DB (:memory: reports journal_mode=memory).
    const dir = Deno.makeTempDirSync();
    const fileDb = new CompatDatabase(`${dir}/t.db`);
    try {
      expect(fileDb.prepare("PRAGMA journal_mode").get()?.journal_mode)
        .toBe("wal");
      expect(fileDb.prepare("PRAGMA busy_timeout").get()?.timeout).toBe(5000);
    } finally {
      fileDb.close();
      Deno.removeSync(dir, { recursive: true });
    }
  });
});
