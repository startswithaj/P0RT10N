import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { DenoCommandRunner, DenoTempFiles } from "../lib/CommandRunner.ts";
import { hasBinary } from "../lib/hasBinary.ts";
import { McShellClient } from "./McShellClient.ts";

// Real `mc` against a real MinIO. Skipped unless P0RT1ON_INTEGRATION is set
// (see deploy/docker-compose.yml). Excluded from the default test + coverage
// runs; invoked via `deno task test:integration`.
describe("McShellClient (integration: real mc + MinIO)", () => {
  const enabled = Boolean(Deno.env.get("P0RT1ON_INTEGRATION")) &&
    hasBinary("mc");
  const maybe = enabled ? it : it.ignore;
  const runner = new DenoCommandRunner();
  const alias = "p0rt1on-it";

  maybe("provisions a locked bucket + scoped user end-to-end", async () => {
    const endpoint = Deno.env.get("MINIO_ENDPOINT") ?? "http://127.0.0.1:9000";
    const user = Deno.env.get("MINIO_ROOT_USER") ?? "p0rtadmin";
    const pass = Deno.env.get("MINIO_ROOT_PASSWORD") ?? "p0rtadmin123";
    await runner.run("mc", ["alias", "set", alias, endpoint, user, pass]);
    // Block until MinIO is accepting requests (handles container startup race).
    await runner.run("mc", ["ready", alias]);

    const bucket = `it-${crypto.randomUUID().slice(0, 8)}`;
    const client = new McShellClient(
      { alias },
      runner,
      new DenoTempFiles(),
    );

    try {
      await client.makeBucketWithLock(bucket);
      expect((await client.du(bucket)).objectCount).toBe(0);

      await client.createUser({
        accessKeyId: "itkey",
        secretKey: "itsecret123",
      });
      await client.putBucketScopedPolicy(bucket, bucket);
      await client.attachPolicy("itkey", bucket);
      await client.setDefaultRetention(bucket, "GOVERNANCE", 1);
      await client.setHardQuota(bucket, 1024 * 1024);
    } finally {
      await client.removeUser("itkey").catch(() => undefined);
      await client.removeBucket(bucket).catch(() => undefined);
    }
  });
});
