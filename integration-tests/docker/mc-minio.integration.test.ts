import { beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  DenoCommandRunner,
  DenoTempFiles,
} from "../../app/packages/server/src/lib/CommandRunner.ts";
import {
  mcHostEnv,
  McShellClient,
} from "../../app/packages/server/src/minio/McShellClient.ts";
import { requireConfig } from "../helpers.ts";

// Real `mc` against a real MinIO. Excluded from default test/coverage runs;
// running it IS the opt-in, so a missing prerequisite FAILS rather than skips.
describe("McShellClient (integration: real mc + MinIO)", () => {
  beforeAll(() =>
    requireConfig({
      binaries: ["mc"],
      hint: "run this suite in the manager image (bundles the pinned mc) " +
        "against a MinIO at MINIO_ENDPOINT; see integration-tests.md.",
    })
  );
  const runner = new DenoCommandRunner();
  const alias = "p0rt1on-integrationtest";

  // Root creds go in per-call MC_HOST env vars — no `mc alias set` bootstrap —
  // which also proves that mechanism against the pinned mc release.
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
    // Wait until MinIO accepts requests; fail HERE if it's down, not
    // confusingly later.
    expect((await runner.run("mc", ["ready", alias], hostEnv())).code).toBe(0);

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

      // Proves listUsers parsing against the pinned mc: the user must appear
      // with its attached bucket policy.
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
      // Regression guard: `rb --force` alone cannot delete versions under
      // retention — removeBucket must purge with --bypass first.
      expect((await runner.run("mc", ["ready", alias], hostEnv())).code)
        .toBe(0);

      const bucket = `it-lock-${crypto.randomUUID().slice(0, 8)}`;
      const client = buildClient();

      await client.makeBucketWithLock(bucket);
      try {
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
      } finally {
        // A retention-armed bucket must not outlive a failed test.
        await client.removeBucket(bucket).catch(() => undefined);
      }
    },
  );
});
