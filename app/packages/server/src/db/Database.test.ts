import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertDbDirWritable } from "./Database.ts";

describe("assertDbDirWritable", () => {
  // Outside the repo working tree on purpose: Deno.makeTempDir() with no
  // `dir` option resolves to the OS temp dir, so git never sees these.
  let root = "";

  beforeEach(async () => {
    root = await Deno.makeTempDir({ prefix: "p0rt1on-db-writable-test" });
  });

  afterEach(async () => {
    // Restore write permission in case a test locked it down, or removal fails.
    await Deno.chmod(root, 0o755).catch(() => {});
    await Deno.remove(root, { recursive: true }).catch(() => {});
  });

  it("passes when the directory is writable", async () => {
    await expect(assertDbDirWritable(`${root}/p0rt1on.db`)).resolves
      .toBeUndefined();
  });

  it("throws naming the path and uid when the directory is not writable", async () => {
    await Deno.chmod(root, 0o555); // read + execute, no write

    // Deno.uid() needs --allow-sys, which the test task doesn't grant (matching
    // the manager's own run configs) — assert a uid is named, not its exact value.
    await expect(assertDbDirWritable(`${root}/p0rt1on.db`)).rejects
      .toThrow(
        new RegExp(`not writable: ${root} \\(running as uid \\S+\\)`),
      );
  });

  it("throws naming the path when the directory does not exist", async () => {
    const missing = `${root}/does-not-exist`;

    await expect(assertDbDirWritable(`${missing}/p0rt1on.db`)).rejects
      .toThrow(
        new RegExp(`does not exist: ${missing}`),
      );
  });
});
