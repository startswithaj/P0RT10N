import { beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import $ from "@david/dax";
import {
  type ClaimedBundle,
  DEFAULT_CLIENT_IMAGE,
  DEFAULT_INSTANCE_IMAGE,
  DEFAULT_MANAGER_IMAGE,
  friendClientEnv,
  requireConfig,
  SEED_THEN_BACKUP,
  sha256Hex,
  trpcClient,
  until,
  VERIFY_REPOSITORY,
} from "../helpers.ts";

describe("Portion lifecycle over a REAL tailnet on docker (e2e)", () => {
  const REQUIRED = [
    "P0RT1ON_MASTER_KEY",
    "P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET",
    // Required on the real Tailscale backend, since the OAuth client can
    // only mint keys for tags it owns (see Env.tagOwner).
    "P0RT1ON_TAILSCALE_TAG_OWNER",
  ];

  beforeAll(() =>
    requireConfig({
      env: REQUIRED,
      binaries: ["docker"],
      hint: "run via deno task test:e2e:docker (loads .env).",
    })
  );

  const id = crypto.randomUUID().slice(0, 6);
  const managerName = `p0rt1on-e2e-manager-${id}`;
  const friendName = `p0rt1on-e2e-friend-${id}`;
  const portion = `dockere2e${id}`;
  // Instances always join the fixed DOCKER_NETWORK, so the manager must be
  // on it too to reach them by name.
  const network = "p0rt1on-net";
  const port = 18080;
  const base = `http://127.0.0.1:${port}`;
  const adminUser = "e2e-admin";
  const adminPass = crypto.randomUUID();
  // Bind-mounts the pantry at the same absolute path inside the manager as
  // compose does, so instance data dirs resolve identically.
  const tmpDir = `${Deno.cwd()}/.p0rt1on-e2e-tmp`;
  const pantry = `${tmpDir}/pantry-${id}`;
  const env = (k: string) => Deno.env.get(k) ?? "";

  const docker = (args: string[]) => $`docker ${args}`.noThrow().quiet();

  const writeEnvFile = async (content: string): Promise<string> => {
    await Deno.mkdir(tmpDir, { recursive: true });
    const path = await Deno.makeTempFile({ dir: tmpDir, prefix: "env-" });
    await Deno.writeTextFile(path, content);
    return path;
  };

  it(
    "creates a portion, and the friend backs up to it over the real tailnet",
    async () => {
      // Secrets ride an env-file, never argv (`ps` is world-readable).
      const managerEnv = await writeEnvFile(
        REQUIRED.map((k) => `${k}=${env(k)}`).join("\n") +
          // The DB lives under /tmp because /app/data only exists when the
          // manager runs under compose.
          `\nP0RT1ON_ADMIN_BIND_HOST=0.0.0.0` +
          `\nP0RT1ON_ADMIN_USERNAME=${adminUser}` +
          `\nP0RT1ON_ADMIN_PASSWORD=${adminPass}` +
          `\nP0RT1ON_INSTANCE_ADDRESSING=network` +
          `\nP0RT1ON_PANTRY=${pantry}` +
          `\nP0RT1ON_DB_PATH=/tmp/p0rt1on.db` +
          `\nP0RT1ON_INSTANCE_IMAGE=${
            Deno.env.get("P0RT1ON_INSTANCE_IMAGE") ?? DEFAULT_INSTANCE_IMAGE
          }\n`,
      );
      let friendId = "";
      // Both env files hold live secrets, so they must be removed even if
      // the test throws mid-flow.
      let friendEnv: string | null = null;
      let verifyEnv: string | null = null;

      const trpc = trpcClient(base);

      try {
        // The pantry dir must exist before the run, since instances
        // bind-mount the same host path the manager writes friend dirs under.
        await Deno.mkdir(pantry, { recursive: true });
        const run = await docker([
          "run",
          "-d",
          "--name",
          managerName,
          "--env-file",
          managerEnv,
          "--user",
          "root", // needs the mounted docker socket
          "-v",
          "/var/run/docker.sock:/var/run/docker.sock",
          "-v",
          `${pantry}:${pantry}`,
          "--network",
          network,
          "-p",
          `127.0.0.1:${port}:8080`,
          Deno.env.get("MANAGER_IMAGE") ?? DEFAULT_MANAGER_IMAGE,
        ]);
        expect(run.code).toBe(0);

        await until("manager /health", async () => {
          const res = await fetch(`${base}/health`);
          const ok = res.status === 200;
          await res.body?.cancel();
          return ok || null;
        }, 30);

        // Auth is required for the non-loopback bind, so the test logs in
        // for real.
        await trpc("auth.login", {
          username: adminUser,
          password: adminPass,
        });

        // Only this suite can say anything true about these: headscale fakes
        // the same reads, so they are trivially "ok" in the k8s suite.
        const health = await trpc("status.recheckHealth", {}) as {
          canProvision: boolean;
          checks: { id: string; status: string; detail: string }[];
        };
        const check = (id: string) => health.checks.find((c) => c.id === id);
        // Both gate provisioning: no MagicDNS means no stable name to serve
        // on, no certificates means serve can't do HTTPS.
        expect(check("magicDns")?.status).toBe("ok");
        expect(check("httpsServe")?.status).toBe("ok");
        expect(check("tailscaleApi")?.status).toBe("ok");
        expect(check("serveTag")?.status).toBe("ok");
        // The pantry is a host path here, so the check must be absent rather
        // than falsely passing.
        expect(check("pantry")).toBeUndefined();
        expect(health.canProvision).toBe(true);

        const { jobId } = await trpc("friends.addStart", {
          name: portion,
          isolationMode: "dedicated",
          quotaBytes: 50 * 1024 * 1024,
          retentionDays: 1,
          lockMode: "GOVERNANCE",
        }) as { jobId: string };

        // claimBundle errors until provisioning finishes, so retrying it
        // is the wait.
        const bundle = await until(
          "provisioning to finish + bundle claim",
          () =>
            trpc("jobs.claimBundle", { jobId })
              .catch(() => null) as Promise<ClaimedBundle | null>,
          90,
        );

        // The endpoint is the node's MagicDNS FQDN (<host>.<tailnet>.ts.net)
        // with a real Tailscale-issued cert, not a mock.
        expect(bundle.s3Endpoint).toContain(".ts.net");
        expect(bundle.s3Endpoint.startsWith("https://")).toBe(true);
        expect(bundle.tsAuthKey ?? "").not.toBe("");

        const friends = await trpc("friends.list") as { id: string }[];
        friendId = friends[0].id;

        const canaryPayload = "p0rt1on-canary";
        friendEnv = await writeEnvFile(
          Object.entries(
            friendClientEnv(bundle, { PAYLOAD: canaryPayload }),
          )
            .map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
        );
        const backup = await docker([
          "run",
          "--name",
          friendName,
          "--env-file",
          friendEnv,
          "--entrypoint",
          "sh",
          Deno.env.get("CLIENT_IMAGE") ?? DEFAULT_CLIENT_IMAGE,
          "-c",
          SEED_THEN_BACKUP,
        ]);
        if (backup.code !== 0) {
          console.error("friend backup log:\n", backup.stdout, backup.stderr);
        }
        // Exit 0 only means Kopia wrote a snapshot; whether it READS BACK is
        // proved below, not by the client grading its own work.
        expect(backup.code).toBe(0);

        // A throwaway container on the same network runs stock kopia straight
        // at the instance, so the shipped entrypoint.sh stays test-free.
        const instancePort = ((await trpc("status.get")) as {
          minio: { detail: string }[];
        }).minio[0].detail.split(":").pop()?.trim();
        expect(instancePort).toBeTruthy();
        verifyEnv = await writeEnvFile(
          Object.entries({
            ...friendClientEnv(bundle),
            S3_ENDPOINT:
              `http://p0rt1on-instance-p0rt1on-${portion}:${instancePort}`,
            // Kopia scopes snapshots by user@host; the backup defaulted this
            // to the bucket name, so a mismatch would verify nothing.
            TAILSCALE_HOSTNAME: bundle.bucket,
          }).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
        );
        const verify = await docker([
          "run",
          "--rm",
          "--env-file",
          verifyEnv,
          "--network",
          network,
          "--entrypoint",
          "sh",
          Deno.env.get("CLIENT_IMAGE") ?? DEFAULT_CLIENT_IMAGE,
          "-c",
          VERIFY_REPOSITORY,
        ]);
        if (verify.code !== 0) {
          console.error("verify log:\n", verify.stdout, verify.stderr);
        }
        expect(verify.code).toBe(0);
        // The hash, not just the exit code: an always-succeeding verifier
        // would still have to produce the canary's real checksum.
        expect(verify.stdout).toContain(
          `canary-sha256=${await sha256Hex(canaryPayload)}`,
        );

        // Waits for offboard to finish, because tearing down while the job
        // runs can leak a node on the real tailnet.
        const off = await trpc("friends.offboardStart", { friendId }) as {
          jobId: string;
        };
        expect(off.jobId.length).toBeGreaterThan(0);
        await until("offboard to finish (friend list empty)", async () => {
          const left = await trpc("friends.list") as unknown[];
          return left.length === 0 || null;
        }, 60);
        // Gone from the host, not just the DB.
        const inspect = await docker([
          "inspect",
          `p0rt1on-instance-p0rt1on-${portion}`,
        ]);
        expect(inspect.code).not.toBe(0);
      } catch (e) {
        // Failure artifact: the assertion alone never says WHICH step broke.
        const logs = await docker(["logs", "--tail", "400", managerName]);
        console.error("manager log:\n", logs.stdout, "\n", logs.stderr);
        throw e;
      } finally {
        // Never leave a node on the REAL tailnet or a container on the host.
        await docker(["rm", "-f", friendName]);
        await docker(["rm", "-f", managerName]);
        await docker(["rm", "-f", `p0rt1on-instance-p0rt1on-${portion}`]);
        await Deno.remove(managerEnv).catch(() => undefined);
        if (friendEnv) await Deno.remove(friendEnv).catch(() => undefined);
        if (verifyEnv) await Deno.remove(verifyEnv).catch(() => undefined);
        await Deno.remove(pantry, { recursive: true }).catch(() => undefined);
      }
    },
  );
});
