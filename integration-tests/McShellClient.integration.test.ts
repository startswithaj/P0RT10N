import { beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  DenoCommandRunner,
  DenoTempFiles,
} from "../app/packages/server/src/lib/CommandRunner.ts";
import { hasBinary } from "../app/packages/server/src/lib/hasBinary.ts";
import {
  mcHostEnv,
  McShellClient,
} from "../app/packages/server/src/minio/McShellClient.ts";

// Real `mc` against a real MinIO. Excluded from the default test + coverage
// runs; invoked via `deno task test:integration` — running the suite IS the
// opt-in, so a missing prerequisite FAILS (never skips).
describe("McShellClient (integration: real mc + MinIO)", () => {
  beforeAll(() => {
    if (!hasBinary("mc")) {
      throw new Error(
        "`mc` not on PATH — run this suite in the manager image (bundles the " +
          "pinned mc) against a MinIO at MINIO_ENDPOINT; see integration-tests.md.",
      );
    }
  });
  const runner = new DenoCommandRunner();
  const alias = "p0rt1on-it";

  // Root creds ride per-call MC_HOST env vars — no `mc alias set` bootstrap;
  // this also grounds the env mechanism against the pinned mc release.
  const endpoint = () =>
    Deno.env.get("MINIO_ENDPOINT") ?? "http://127.0.0.1:9000";

  const rootCred = () => ({
    accessKeyId: Deno.env.get("MINIO_ROOT_USER") ?? "p0rtadmin",
    secretKey: Deno.env.get("MINIO_ROOT_PASSWORD") ?? "p0rtadmin123",
  });

  const buildClient = () => {
    const port = Number(new URL(endpoint()).port || 9000);
    return new McShellClient(
      { alias, minioPort: port },
      rootCred(),
      endpoint(),
      runner,
      new DenoTempFiles(),
    );
  };

  const hostEnv = () => mcHostEnv(alias, endpoint(), rootCred());

  it("provisions a locked bucket + scoped user end-to-end", async () => {
    // Block until MinIO is accepting requests (handles container startup race).
    await runner.run("mc", ["ready", alias], hostEnv());

    const bucket = `it-${crypto.randomUUID().slice(0, 8)}`;
    const client = buildClient();

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

      // Grounds the listUsers parsing against the pinned mc version: the user
      // must be reported with its attached bucket policy.
      const users = await client.listUsers();
      const itUser = users.find((u) => u.accessKeyId === "itkey");
      expect(itUser?.policies).toContain(bucket);
    } finally {
      await client.removeUser("itkey").catch(() => undefined);
      await client.removeBucket(bucket).catch(() => undefined);
    }
  });

  it(
    "removeBucket deletes GOVERNANCE-locked objects (root bypass)",
    async () => {
      // The offboard-blocker regression: `rb --force` alone cannot delete
      // versions still under retention; removeBucket must purge with --bypass
      // first. Grounds the flag set against the pinned mc release.
      await runner.run("mc", ["ready", alias], hostEnv());

      const bucket = `it-lock-${crypto.randomUUID().slice(0, 8)}`;
      const client = buildClient();

      await client.makeBucketWithLock(bucket);
      await client.setDefaultRetention(bucket, "GOVERNANCE", 1);
      // Write an object AFTER retention is armed so it is genuinely locked.
      const tmp = await new DenoTempFiles().write("locked-data");
      try {
        const put = await runner.run(
          "mc",
          ["cp", tmp, `${alias}/${bucket}/x`],
          hostEnv(),
        );
        expect(put.code).toBe(0);
      } finally {
        await new DenoTempFiles().remove(tmp);
      }

      await client.removeBucket(bucket); // fails without the --bypass purge

      // Also idempotent: removing the now-absent bucket is success.
      await client.removeBucket(bucket);
    },
  );
});
