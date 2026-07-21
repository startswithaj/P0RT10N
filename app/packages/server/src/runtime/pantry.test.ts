import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";
import { HostPantry } from "./pantry.ts";

describe("HostPantry", () => {
  it("maps an instance to one directory directly under the root", () => {
    const p = new HostPantry("/srv/p0rt1on");
    expect(p.dataDir("alice")).toBe(join("/srv/p0rt1on", "alice"));
  });

  // friendNameSchema constrains names upstream; this is the last-line guard so
  // a bad name can never resolve outside the pantry before a mount or delete.
  const escapes = ["..", "../etc", "nested/dir", ""];
  escapes.forEach((name) => {
    it(`refuses a name that escapes the pantry: ${JSON.stringify(name)}`, () => {
      const p = new HostPantry("/srv/p0rt1on");
      expect(() => p.dataDir(name)).toThrow("escapes the pantry");
    });
  });

  describe("against a real temp directory", () => {
    let root = "";
    beforeEach(async () => {
      root = await Deno.makeTempDir({ prefix: "p0rt1on-pantry-test" });
    });
    afterEach(async () => {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    });

    it("ensure creates the tree and is idempotent", async () => {
      const p = new HostPantry(root);
      await p.ensure("alice");
      await p.ensure("alice"); // second ensure over an existing tree is a no-op
      const stat = await Deno.stat(join(root, "alice"));
      expect(stat.isDirectory).toBe(true);
    });

    it("remove deletes only the instance's subtree", async () => {
      const p = new HostPantry(root);
      await p.ensure("alice");
      await p.ensure("bob");
      await p.remove("alice");
      await expect(Deno.stat(join(root, "alice"))).rejects.toThrow();
      expect((await Deno.stat(join(root, "bob"))).isDirectory).toBe(true);
    });

    it("remove tolerates an already-absent subtree", async () => {
      const p = new HostPantry(root);
      await p.remove("never-created"); // NotFound is success, not a throw
    });

    it("exists is false when absent, false when empty, true with data", async () => {
      const p = new HostPantry(root);
      expect(await p.exists("alice")).toBe(false); // never created
      await p.ensure("alice");
      expect(await p.exists("alice")).toBe(false); // dir exists but empty
      await Deno.writeTextFile(join(root, "alice", ".minio.sys"), "x");
      expect(await p.exists("alice")).toBe(true); // has data
    });
  });
});
