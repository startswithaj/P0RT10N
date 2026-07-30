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
  trpcClient,
  until,
} from "../helpers.ts";

// E2E: the SHIPPED containers over a REAL tailnet — the manager mints a key
// from the OAuth secret, the instance enrolls, and a friend container writes
// a real Kopia backup through `tailscale serve`. Only this suite proves HTTPS
// serve with real certs. No app code is imported. Missing config fails, never
// skips — run via deno task test:e2e:docker (loads .env).
describe("Portion lifecycle over a REAL tailnet on docker (e2e)", () => {
  const REQUIRED = [
    "P0RT1ON_MASTER_KEY",
    "P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET",
    // Required on the real Tailscale backend — the OAuth client can only mint
    // keys for tags it owns (see Env.tagOwner).
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
  const managerName = `p0rt1on-integrationtest-manager-${id}`;
  const friendName = `p0rt1on-integrationtest-friend-${id}`;
  const portion = `dockerintegrationtest${id}`;
  // Instances join this fixed runtime network (DOCKER_NETWORK); the manager
  // must be on it too or it cannot reach them by name.
  const network = "p0rt1on-net";
  const port = 18080;
  const base = `http://127.0.0.1:${port}`;
  // Not a real secret: the non-loopback bind requires auth, so the test mints
  // its own ephemeral creds.
  const adminUser = "integrationtest-admin";
  const adminPass = crypto.randomUUID();
  // Throwaway pantry dir, bind-mounted at the same absolute path inside the
  // manager (as compose does) so instance data dirs resolve identically.
  const tmpDir = `${Deno.cwd()}/.p0rt1on-integrationtest-tmp`;
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
          // Auth must be on for the non-loopback bind. Throwaway DB under
          // /tmp — /app/data only exists under compose.
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
      // Both env-files hold live secrets — remove them even if the test
      // throws mid-flow.
      let friendEnv: string | null = null;

      const trpc = trpcClient(base);

      try {
        // Instances bind-mount the same host path the manager writes friend
        // dirs under, so it must exist before the run.
        await Deno.mkdir(pantry, { recursive: true });
        // 1. The REAL manager image, launching instances via the host socket.
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

        // 2. Auth is REQUIRED for the non-loopback bind — log in for real.
        await trpc("auth.login", {
          username: adminUser,
          password: adminPass,
        });

        // 3. Create the portion. The manager mints the tailnet key from the
        //    OAuth secret; the instance container enrolls for real.
        const { jobId } = await trpc("friends.addStart", {
          name: portion,
          isolationMode: "dedicated",
          quotaBytes: 50 * 1024 * 1024,
          retentionDays: 1,
          lockMode: "GOVERNANCE",
        }) as { jobId: string };

        // The bundle is claimable once provisioning finishes; claimBundle
        // errors until then, so retrying it IS the wait.
        const bundle = await until(
          "provisioning to finish + bundle claim",
          () =>
            trpc("jobs.claimBundle", { jobId })
              .catch(() => null) as Promise<ClaimedBundle | null>,
          90,
        );

        // A real HTTPS endpoint with a real cert — always the node's MagicDNS
        // FQDN (<host>.<tailnet>.ts.net).
        expect(bundle.s3Endpoint).toContain(".ts.net");
        expect(bundle.s3Endpoint.startsWith("https://")).toBe(true);
        expect(bundle.tsAuthKey ?? "").not.toBe("");

        const friends = await trpc("friends.list") as { id: string }[];
        friendId = friends[0].id;

        // 4. The point: a friend container joins the tailnet with the minted
        //    key and writes a real Kopia backup through `tailscale serve`.
        friendEnv = await writeEnvFile(
          Object.entries(friendClientEnv(bundle, { PAYLOAD: "p0rt1on-canary" }))
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
        // Exit 0 means Kopia connected over the tailnet and wrote a snapshot.
        expect(backup.code).toBe(0);

        // 5. Offboard, and WAIT for it: tearing down while the job runs can
        //    leak a node on the REAL tailnet.
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
