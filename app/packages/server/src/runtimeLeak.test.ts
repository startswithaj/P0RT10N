import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

// ============================================================================
// Tripwire: docker vocabulary must not re-leak out of runtime/. The domain
// layers (provisioning/, boot/, services/) describe instances in domain
// language; container names, volume names, the docker network, and
// host-gateway addressing are the docker runtime's business alone. A match
// here means a docker-ism crossed the InstanceRuntime seam.
// ============================================================================

describe("runtime vocabulary tripwire", () => {
  const BANNED =
    /host\.docker\.internal|p0rt1on-data-|"p0rt1on-net"|p0rt1on-instance-/;
  const DIRS = ["provisioning", "boot", "services"];
  const here = new URL(".", import.meta.url).pathname;

  const sourceFiles = async (dir: string): Promise<string[]> => {
    const entries = await Array.fromAsync(Deno.readDir(`${here}${dir}`));
    return entries
      .filter((e) => e.isFile && e.name.endsWith(".ts"))
      .filter((e) => !e.name.includes(".test."))
      .map((e) => `${here}${dir}/${e.name}`);
  };

  it("no docker literals outside runtime/", async () => {
    const files = (await Promise.all(DIRS.map(sourceFiles))).flat();
    expect(files.length).toBeGreaterThan(0);
    const leaks = await Promise.all(
      files.map(async (path) =>
        BANNED.test(await Deno.readTextFile(path)) ? path : null
      ),
    );
    expect(leaks.filter(Boolean)).toEqual([]);
  });
});
