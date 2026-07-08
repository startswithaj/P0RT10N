import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { DockerRuntime } from "./DockerRuntime.ts";
import { DenoCommandRunner, DenoTempFiles } from "../lib/CommandRunner.ts";
import { hasBinary } from "../lib/hasBinary.ts";
import type { ContainerRunSpec } from "./runtime.ts";

// Drives the REAL host Docker daemon with the combined p0rt1on-instance image, so
// it needs a real Tailscale auth key too. Runs on the host (not in-container like
// the mc IT). Skipped unless P0RT1ON_INTEGRATION + TAILSCALE_AUTHKEY are set.
// Excluded from the default test + coverage runs.
describe("DockerRuntime (integration: real docker + instance image)", () => {
  const dockerReady = Boolean(Deno.env.get("P0RT1ON_INTEGRATION")) &&
    hasBinary("docker");
  const enabled = dockerReady && Boolean(Deno.env.get("TAILSCALE_AUTHKEY"));
  const maybe = enabled ? it : it.ignore;
  const runtime = new DockerRuntime(new DenoCommandRunner());
  const tmp = new DenoTempFiles("./.p0rt1on-it-tmp");

  maybe(
    "starts an instance container, is idempotent + healthy, then tears it down",
    async () => {
      const id = crypto.randomUUID().slice(0, 8);
      // The auth key rides the env-file like the root creds — never the argv.
      const envFile = await tmp.write(
        "MINIO_ROOT_USER=p0rtadmin\nMINIO_ROOT_PASSWORD=p0rtadmin123\n" +
          `TAILSCALE_AUTHKEY=${Deno.env.get("TAILSCALE_AUTHKEY") ?? ""}\n`,
      );
      const spec: ContainerRunSpec = {
        name: `p0rt1on-it-${id}`,
        image: Deno.env.get("INSTANCE_IMAGE") ?? "p0rt1on-instance:latest",
        tsHostname: `p0rtit${id}`,
        tag: Deno.env.get("SERVE_NODE_TAG") ?? "tag:p0rt1on-serve",
        minioPort: 9000,
        dataVolume: `p0rt1on-it-data-${id}`,
        stateVolume: `p0rt1on-it-state-${id}`,
        rootCredSecretRef: envFile,
        network: Deno.env.get("P0RT1ON_NETWORK") ?? "bridge",
      };

      try {
        const first = await runtime.ensureInstance(spec);
        expect(first.state).toBe("running");
        expect(await runtime.status(spec.name)).toBe("running");

        // Idempotent: a second ensure adopts the same container id.
        const second = await runtime.ensureInstance(spec);
        expect(second.id).toBe(first.id);

        expect((await runtime.list()).some((c) => c.name === spec.name)).toBe(
          true,
        );
      } finally {
        await runtime.remove(spec.name, { removeVolume: true }).catch(
          () => undefined,
        );
        await tmp.remove(envFile);
      }
    },
  );
});
