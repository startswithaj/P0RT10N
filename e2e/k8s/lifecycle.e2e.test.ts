import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  type ClaimedBundle,
  DEFAULT_CLIENT_IMAGE,
  friendClientEnv,
  mcHostEnvFor,
  requireConfig,
  SEED_THEN_BACKUP,
  trpcClient,
  until,
} from "../helpers.ts";

describe("Portion lifecycle against the real manager on k8s (e2e)", () => {
  const PORTION = "k8sit";
  const INSTANCE = `p0rt1on-${PORTION}`;
  const CLIENT_NS = "p0rt1on-e2e-clients";
  const CLIENT_POD = "p0rt1on-e2e-client";

  beforeAll(() =>
    requireConfig({
      env: [
        "MANAGER_URL",
        "P0RT1ON_ADMIN_USERNAME",
        "P0RT1ON_ADMIN_PASSWORD",
        "HEADSCALE_URL",
        "HEADSCALE_API_KEY",
      ],
      binaries: ["mc"],
      hint: "run via deno task test:e2e:k8s lifecycle (in-cluster).",
    })
  );

  const env = (k: string) => Deno.env.get(k) ?? "";
  const namespace = () => Deno.env.get("K8S_NAMESPACE") ?? "p0rt1on";

  const saToken = () =>
    Deno.readTextFileSync(
      "/var/run/secrets/kubernetes.io/serviceaccount/token",
    ).trim();

  // fetch trusts the cluster CA via DENO_CERT, set on the runner pod, so no
  // explicit HTTP client is needed here.
  const k8s = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> => {
    const res = await fetch(`https://kubernetes.default.svc${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${saToken()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const podPhase = async (ns: string, name: string): Promise<string> => {
    const res = await k8s("GET", `/api/v1/namespaces/${ns}/pods/${name}`);
    if (res.status === 404) return "Absent";
    const pod = res.body as { status?: { phase?: string } };
    return pod.status?.phase ?? "Unknown";
  };

  // The manager allocates the port, so read it off the Service it created.
  const instanceEndpoint = async (): Promise<string> => {
    const res = await k8s(
      "GET",
      `/api/v1/namespaces/${namespace()}/services/${INSTANCE}`,
    );
    const svc = res.body as { spec?: { ports?: { port?: number }[] } };
    const port = svc.spec?.ports?.[0]?.port;
    if (!port) {
      throw new Error(`no port on service ${INSTANCE} (${res.status})`);
    }
    return `http://${INSTANCE}.${namespace()}.svc:${port}`;
  };

  // Runs `mc` as the friend with credentials in env, never argv.
  const asFriend = async (
    cred: { s3AccessKeyId: string; s3SecretKey: string },
    args: (alias: string) => string[],
  ) => {
    const alias = `e2e${crypto.randomUUID().slice(0, 8)}`;
    const out = await new Deno.Command("mc", {
      args: args(alias),
      env: mcHostEnvFor(
        alias,
        await instanceEndpoint(),
        cred.s3AccessKeyId,
        cred.s3SecretKey,
      ),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    const res = {
      code: out.code,
      stdout: dec.decode(out.stdout),
      stderr: dec.decode(out.stderr),
    };
    // Logs rather than throws, since some calls are meant to fail and a
    // bare exit code alone is not evidence.
    if (res.code !== 0) console.error(`mc exit ${res.code}: ${res.stderr}`);
    return res;
  };

  const trpc = trpcClient(env("MANAGER_URL"));

  // The client pod gets only the bundle, exactly like a real friend.
  const backupOverTailnet = async (bundle: ClaimedBundle): Promise<void> => {
    await k8s("POST", `/api/v1/namespaces/${CLIENT_NS}/pods`, {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: CLIENT_POD, namespace: CLIENT_NS },
      spec: {
        restartPolicy: "Never",
        containers: [{
          name: "client",
          image: Deno.env.get("CLIENT_IMAGE") ?? DEFAULT_CLIENT_IMAGE,
          command: ["sh", "-c", SEED_THEN_BACKUP],
          env: Object.entries(friendClientEnv(bundle, {
            PAYLOAD: "p0rt1on-canary",
            TAILSCALE_LOGIN_SERVER: env("HEADSCALE_URL"),
          })).map(([name, value]) => ({ name, value })),
        }],
      },
    });

    // Kopia is one-shot, and the two-minute budget covers enrollment, the
    // repo, and the snapshot.
    const phase = await until("client pod terminal phase", async () => {
      const p = await podPhase(CLIENT_NS, CLIENT_POD);
      return p === "Succeeded" || p === "Failed" ? p : null;
    }, 60).catch(() => "Pending");
    if (phase !== "Succeeded") {
      const logs = await fetch(
        `https://kubernetes.default.svc/api/v1/namespaces/${CLIENT_NS}` +
          `/pods/${CLIENT_POD}/log?tailLines=100`,
        { headers: { Authorization: `Bearer ${saToken()}` } },
      );
      console.error(
        "backup-client log:",
        logs.ok ? await logs.text() : "<no log>",
      );
    }
    expect(phase).toBe("Succeeded");

    const ls = await asFriend(bundle, (a) => ["ls", `${a}/${bundle.bucket}`]);
    expect(ls.code).toBe(0);
    expect(ls.stdout.trim().length).toBeGreaterThan(0);
  };

  afterAll(async () => {
    // Best-effort cleanup; offboard via the API is the only remover allowed.
    await k8s(
      "DELETE",
      `/api/v1/namespaces/${CLIENT_NS}/pods/${CLIENT_POD}`,
    ).catch(() => undefined);
    await trpc("friends.list").then(async (friends) => {
      const left = friends as { id: string }[];
      if (left.length === 0) return;
      await trpc("friends.offboardStart", { friendId: left[0].id });
      await until("leftover friend offboarded", async () => {
        const now = await trpc("friends.list") as unknown[];
        return now.length === 0 || null;
      }, 60);
    }).catch(() => undefined);
  });

  it(
    "add → backup → suspend/resume → rotate → offboard, all via the API",
    async () => {
      // Polls /health since there is no readiness probe, and boot runs
      // migrations and preflight checks first.
      await until("manager /health", async () => {
        const res = await fetch(`${env("MANAGER_URL")}/health`)
          .catch(() => null);
        const ok = res?.status === 200;
        await res?.body?.cancel();
        return ok || null;
      }, 30);

      // Auth is mandatory, since the e2e manager binds non-loopback.
      await trpc("auth.login", {
        username: env("P0RT1ON_ADMIN_USERNAME"),
        password: env("P0RT1ON_ADMIN_PASSWORD"),
      });

      // friends.addStart detaches a job, so retrying claimBundle is the wait.
      const { jobId } = await trpc("friends.addStart", {
        name: PORTION,
        isolationMode: "dedicated",
        quotaBytes: 10 * 1024 * 1024,
        retentionDays: 1,
        lockMode: "GOVERNANCE",
      }) as { jobId: string };
      const bundle = await until(
        "provisioning to finish + bundle claim",
        () =>
          trpc("jobs.claimBundle", { jobId })
            .catch(() => null) as Promise<ClaimedBundle | null>,
        90,
      );

      // http mode addresses the node by tailnet IP, so friends need no
      // MagicDNS; headscale mints addresses from 100.64.0.0/10.
      expect(bundle.s3Endpoint).toMatch(/^http:\/\/100\./);
      expect(bundle.s3SecretKey.length).toBeGreaterThan(0);
      expect((bundle.tsAuthKey ?? "").length).toBeGreaterThan(0);

      // The instance pod exists in the cluster BECAUSE of the API call.
      expect(await podPhase(namespace(), `${INSTANCE}-0`)).toBe("Running");
      const friends = await trpc("friends.list") as {
        id: string;
        status: string;
      }[];
      const friendId = friends[0].id;
      expect(friends[0].status).toBe("active");

      await backupOverTailnet(bundle);

      // `rm` only marks-delete, since friend creds are denied DeleteObjectVersion
      // and BypassGovernanceRetention; the canary goes in after retention arms, so Kopia's own churn cannot be mistaken for the proof.
      const canary = `ransom-canary-${crypto.randomUUID().slice(0, 8)}`;
      const canaryFile = await Deno.makeTempFile();
      await Deno.writeTextFile(canaryFile, canary);
      try {
        const put = await asFriend(bundle, (a) => [
          "cp",
          canaryFile,
          `${a}/${bundle.bucket}/${canary}`,
        ]);
        expect(put.code).toBe(0);

        const purge = await asFriend(bundle, (a) => [
          "rm",
          "--versions",
          "--bypass",
          "--force",
          `${a}/${bundle.bucket}/${canary}`,
        ]);
        expect(purge.code).not.toBe(0);

        // The refusal alone is not proof; the bytes must still be readable.
        const read = await asFriend(bundle, (a) => [
          "cat",
          `${a}/${bundle.bucket}/${canary}`,
        ]);
        expect(read.code).toBe(0);
        expect(read.stdout.trim()).toBe(canary);

        // Suspend cuts ACCESS (S3 user disabled, nodes revoked), never data.
        const suspended = await trpc("friends.suspend", { friendId }) as {
          status: string;
        };
        expect(suspended.status).toBe("suspended");
        expect(
          (await asFriend(bundle, (a) => ["ls", `${a}/${bundle.bucket}`])).code,
        ).not.toBe(0);

        const resumed = await trpc("friends.resume", { friendId }) as {
          status: string;
        };
        expect(resumed.status).toBe("active");
        await until("friend reads canary after resume", async () => {
          const read2 = await asFriend(bundle, (a) => [
            "cat",
            `${a}/${bundle.bucket}/${canary}`,
          ]);
          return (read2.code === 0 && read2.stdout.trim() === canary) || null;
        }, 30);
      } finally {
        await Deno.remove(canaryFile).catch(() => undefined);
      }

      // A write past the 10 MiB quota set at addStart must be refused.
      const oversizeFile = await Deno.makeTempFile();
      await Deno.writeTextFile(oversizeFile, "x".repeat(11 * 1024 * 1024));
      try {
        const overQuota = await asFriend(bundle, (a) => [
          "cp",
          oversizeFile,
          `${a}/${bundle.bucket}/oversize`,
        ]);
        expect(overQuota.code).not.toBe(0);
      } finally {
        await Deno.remove(oversizeFile).catch(() => undefined);
      }

      // Rotation must prove the old key is dead and the new key is live,
      // not just that a new key exists.
      const rotated = await trpc("friends.rotateKey", { friendId }) as {
        s3AccessKeyId: string;
        s3SecretKey: string;
      };
      expect(rotated.s3AccessKeyId).not.toBe(bundle.s3AccessKeyId);
      expect(
        (await asFriend(bundle, (a) => ["ls", `${a}/${bundle.bucket}`])).code,
      ).not.toBe(0);
      expect(
        (await asFriend(rotated, (a) => ["ls", `${a}/${bundle.bucket}`]))
          .code,
      ).toBe(0);

      // The friend list empties only when the detached job finishes.
      await trpc("friends.offboardStart", { friendId });
      await until("offboard to finish (friend list empty)", async () => {
        const left = await trpc("friends.list") as unknown[];
        return left.length === 0 || null;
      }, 60);

      // Checks by name, since the SA has `get` but not `list`; a resource
      // with a deletionTimestamp counts as gone, since deletion is async.
      const cleanedUp = async (kind: string, name: string) => {
        const res = await k8s(
          "GET",
          `/api/v1/namespaces/${namespace()}/${kind}/${name}`,
        );
        if (res.status === 404) return true;
        const obj = res.body as { metadata?: { deletionTimestamp?: string } };
        return obj.metadata?.deletionTimestamp !== undefined;
      };

      expect(await cleanedUp("persistentvolumeclaims", `${INSTANCE}-data`))
        .toBe(true);
      expect(await cleanedUp("persistentvolumeclaims", `${INSTANCE}-state`))
        .toBe(true);
      expect(await cleanedUp("secrets", `${INSTANCE}-creds`)).toBe(true);
      expect(await cleanedUp("services", INSTANCE)).toBe(true);
      expect(await podPhase(namespace(), `${INSTANCE}-0`)).toBe("Absent");

      // Both tailnet nodes are gone, per headscale itself.
      const nodes = await fetch(`${env("HEADSCALE_URL")}/api/v1/node`, {
        headers: { Authorization: `Bearer ${env("HEADSCALE_API_KEY")}` },
      }).then((r) => r.json()) as { nodes?: { name?: string }[] };
      expect(
        (nodes.nodes ?? []).filter((n) => n.name?.includes(PORTION)),
      ).toEqual([]);
    },
  );
});
