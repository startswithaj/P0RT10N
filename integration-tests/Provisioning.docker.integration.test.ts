import { beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { DenoTempFiles } from "../app/packages/server/src/lib/CommandRunner.ts";
import { hasBinary } from "../app/packages/server/src/lib/hasBinary.ts";

// The PORTION-level DOCKER integration over a REAL tailnet. Unlike the k8s
// tier (which plays the manager in-process against headscale), this runs the
// REAL manager image as a container and drives it through its HTTP tRPC
// surface — so the image, the docker-socket wiring and the auth surface are
// all under test. The manager mints the Tailscale key from the OAuth client
// secret, the instance container enrolls on the real tailnet, and a FRIEND
// container joins that same tailnet with the MINTED bundle key to write a
// real Kopia backup through `tailscale serve`.
//
// The test process never joins the tailnet — the friend container does, like a
// friend's actual machine. That is also why this needs no host Tailscale.
//
// What only this tier can prove: `tailscale serve` over HTTPS with real certs
// (headscale issues none) and real tailnet semantics.
//
// Missing config FAILS (never skips): run it via
// ./integration-tests/run-docker-tailnet.sh, which loads .env for you.
describe("Portion lifecycle over a REAL tailnet on docker (integration)", () => {
  const REQUIRED = [
    "P0RT1ON_MASTER_KEY",
    "P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET",
    "P0RT1ON_TAILSCALE_TAILNET_DOMAIN",
    // Required on the real Tailscale backend — the OAuth client can only mint
    // keys for tags it owns (see Env.tagOwner).
    "P0RT1ON_TAILSCALE_TAG_OWNER",
    "P0RT1ON_ADMIN_USERNAME",
    "P0RT1ON_ADMIN_PASSWORD",
  ];

  beforeAll(() => {
    const missing = REQUIRED.filter((k) => !Deno.env.get(k));
    if (!hasBinary("docker")) missing.push("`docker` on PATH");
    if (missing.length) {
      throw new Error(
        `not configured: ${missing.join(", ")} — run via ` +
          `./integration-tests/run-docker-tailnet.sh (loads .env).`,
      );
    }
  });

  const id = crypto.randomUUID().slice(0, 6);
  const managerName = `p0rt1on-it-manager-${id}`;
  const friendName = `p0rt1on-it-friend-${id}`;
  const portion = `dockerit${id}`;
  // The network instances join is fixed in the runtime (DOCKER_NETWORK); the
  // manager container has to be on it too, or it cannot reach them by name.
  const network = "p0rt1on-net";
  const port = 18080;
  const base = `http://127.0.0.1:${port}`;
  const tmp = new DenoTempFiles("./.p0rt1on-it-tmp");
  const env = (k: string) => Deno.env.get(k) ?? "";

  const docker = async (args: string[]) => {
    const out = await new Deno.Command("docker", {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    return {
      code: out.code,
      stdout: dec.decode(out.stdout),
      stderr: dec.decode(out.stderr),
    };
  };

  // Poll `fn` until it returns a value (recursive — no imperative loops).
  const until = async <T>(
    what: string,
    fn: () => Promise<T | null>,
    left: number,
  ): Promise<T> => {
    const got = await fn().catch(() => null);
    if (got !== null && got !== undefined) return got;
    if (left <= 0) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2000));
    return until(what, fn, left - 1);
  };

  it(
    "creates a portion, and the friend backs up to it over the real tailnet",
    async () => {
      // Secrets ride an env-file, never argv (`ps` is world-readable).
      const managerEnv = await tmp.write(
        REQUIRED.map((k) => `${k}=${env(k)}`).join("\n") +
          // A non-loopback admin bind is allowed ONLY with auth on — it is.
          // DB under /tmp: `/app/data` is a compose volume mount, absent from
          // a bare `docker run`, and a per-run throwaway DB is what a test
          // wants anyway. This manager's allocator therefore cannot see ports
          // a DEV manager already handed out; it bind-probes each candidate,
          // so it only collides with a dev instance that is stopped (its port
          // reads as free) and is started again mid-run.
          `\nP0RT1ON_ADMIN_BIND_HOST=0.0.0.0` +
          `\nP0RT1ON_INSTANCE_ADDRESSING=network` +
          `\nP0RT1ON_DB_PATH=/tmp/p0rt1on.db` +
          `\nP0RT1ON_INSTANCE_IMAGE=${
            Deno.env.get("P0RT1ON_INSTANCE_IMAGE") ?? "p0rt1on-instance:it"
          }\n`,
      );
      let cookie = "";
      let friendId = "";
      // Both env-files hold live secrets (master key, OAuth secret, the
      // friend's S3 key + minted auth key) — they MUST be removed even if the
      // test throws mid-flow.
      let friendEnv: string | null = null;

      const trpc = async (proc: string, input?: unknown) => {
        const res = await fetch(`${base}/trpc/${proc}`, {
          method: input === undefined ? "GET" : "POST",
          headers: {
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          body: input === undefined ? undefined : JSON.stringify(input),
        });
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) cookie = setCookie.split(";")[0];
        const body = await res.json().catch(() => null) as {
          result?: { data?: unknown };
          error?: { message?: string };
        } | null;
        if (!res.ok || body?.error) {
          throw new Error(
            `trpc ${proc} failed (${res.status}): ${
              body?.error?.message ?? "<no body>"
            }`,
          );
        }
        return body?.result?.data;
      };

      try {
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
          "--network",
          network,
          "-p",
          `127.0.0.1:${port}:8080`,
          Deno.env.get("MANAGER_IMAGE") ?? "p0rt1on-manager:it",
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
          username: env("P0RT1ON_ADMIN_USERNAME"),
          password: env("P0RT1ON_ADMIN_PASSWORD"),
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
            trpc("jobs.claimBundle", { jobId }).catch(() => null) as Promise<
              {
                bucket: string;
                s3Endpoint: string;
                s3AccessKeyId: string;
                s3SecretKey: string;
                tsAuthKey?: string;
              } | null
            >,
          90,
        );

        // Real serve endpoint on the real tailnet — HTTPS with a real cert,
        // the thing headscale structurally cannot prove.
        expect(bundle.s3Endpoint).toContain(
          env("P0RT1ON_TAILSCALE_TAILNET_DOMAIN"),
        );
        expect(bundle.s3Endpoint.startsWith("https://")).toBe(true);
        expect(bundle.tsAuthKey ?? "").not.toBe("");

        const friends = await trpc("friends.list") as { id: string }[];
        friendId = friends[0].id;

        // 4. THE POINT: a friend container joins the tailnet with the MINTED
        //    key and writes a real Kopia backup through `tailscale serve`.
        //    Userspace tailscaled — no TUN, so a plain `docker run` suffices.
        friendEnv = await tmp.write(
          `S3_ENDPOINT=${bundle.s3Endpoint}\nS3_BUCKET=${bundle.bucket}\n` +
            `S3_ACCESS_KEY_ID=${bundle.s3AccessKeyId}\n` +
            `S3_SECRET_ACCESS_KEY=${bundle.s3SecretKey}\n` +
            `TAILSCALE_AUTHKEY=${bundle.tsAuthKey}\n` +
            `KOPIA_PASSWORD=it-kopia-pw\nBACKUP_PATH=/backup\n`,
        );
        const backup = await docker([
          "run",
          "--name",
          friendName,
          "--env-file",
          friendEnv,
          "--entrypoint",
          "sh",
          Deno.env.get("CLIENT_IMAGE") ?? "p0rt1on-backup-client:it",
          "-c",
          "mkdir -p /backup && echo p0rt1on-canary > /backup/canary.txt && " +
          "exec /entrypoint.sh",
        ]);
        if (backup.code !== 0) {
          console.error("friend backup log:\n", backup.stdout, backup.stderr);
        }
        // Exit 0 means Kopia connected over the tailnet and wrote a snapshot.
        expect(backup.code).toBe(0);

        // 5. Offboard tears the portion down for real.
        const off = await trpc("friends.offboardStart", { friendId }) as {
          jobId: string;
        };
        expect(off.jobId.length).toBeGreaterThan(0);
      } catch (e) {
        // Failure artifact: the assertion alone never says WHICH step broke.
        const logs = await docker(["logs", "--tail", "400", managerName]);
        console.error("manager log:\n", logs.stdout, "\n", logs.stderr);
        throw e;
      } finally {
        // Never leave a node on the REAL tailnet or a container on the host.
        await docker(["rm", "-f", friendName]);
        await docker(["logs", managerName]).then((l) =>
          l.code === 0 ? undefined : undefined
        );
        await docker(["rm", "-f", managerName]);
        await docker(["rm", "-f", `p0rt1on-instance-p0rt1on-${portion}`]);
        await tmp.remove(managerEnv).catch(() => undefined);
        if (friendEnv) await tmp.remove(friendEnv).catch(() => undefined);
      }
    },
  );
});
