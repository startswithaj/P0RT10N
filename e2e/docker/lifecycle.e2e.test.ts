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
            friendClientEnv(bundle, {
              PAYLOAD: canaryPayload,
              // VERIFY_RESTORE checks the snapshot is intact and retrievable
              // straight from the repository (safe on live data). DIFF
              // additionally restores it and compares byte-for-byte against
              // BACKUP_PATH — only safe here because nothing else touches
              // /backup after the seed step. VERBOSE prints a checksum per
              // restored file so this test can assert on it below,
              // independent of the entrypoint's own pass/fail logic.
              VERIFY_RESTORE: "1",
              VERIFY_RESTORE_DIFF: "1",
              VERIFY_RESTORE_VERBOSE: "1",
            }),
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
        // Exit 0 now means Kopia connected over the tailnet, wrote a
        // snapshot, the repository copy verified intact, AND a restore of
        // it matched BACKUP_PATH byte for byte.
        expect(backup.code).toBe(0);
        // Independent of entrypoint.sh's own pass/fail logic: recompute the
        // canary's checksum here and require the exact line the restore step
        // printed, so a broken verify inside the image (e.g. one that always
        // logs success) can't silently pass this test.
        const canaryHash = await sha256Hex(canaryPayload);
        expect(backup.stdout).toContain(
          `VERIFY_RESTORE_DIFF: sha256(canary.txt)=${canaryHash}`,
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
        await Deno.remove(pantry, { recursive: true }).catch(() => undefined);
      }
    },
  );
});
