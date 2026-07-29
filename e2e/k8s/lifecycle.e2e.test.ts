import { beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createCallerFactory } from "../../app/packages/server/src/trpc/trpc.ts";
import { appRouter } from "../../app/packages/server/src/trpc/root.ts";
import type { TrpcContext } from "../../app/packages/server/src/trpc/trpc.ts";
import { ProvisioningService } from "../../app/packages/server/src/provisioning/ProvisioningService.ts";
import {
  buildRestClient,
  KubernetesRuntime,
} from "../../app/packages/server/src/runtime/KubernetesRuntime.ts";
import { CryptoKeyGen } from "../../app/packages/server/src/provisioning/CryptoKeyGen.ts";
import {
  mcHostEnv,
  McShellClientFactory,
} from "../../app/packages/server/src/minio/McShellClient.ts";
import { McSmokeTester } from "../../app/packages/server/src/provisioning/McSmokeTester.ts";
import { DrizzleProvisioningRepo } from "../../app/packages/server/src/db/ProvisioningRepo.ts";
import { FriendQueries } from "../../app/packages/server/src/db/FriendQueries.ts";
import {
  DenoCommandRunner,
  DenoTempFiles,
} from "../../app/packages/server/src/lib/CommandRunner.ts";
import { FriendServiceImpl } from "../../app/packages/server/src/services/FriendService.ts";
import { ActivityServiceImpl } from "../../app/packages/server/src/services/ActivityService.ts";
import { AuditServiceImpl } from "../../app/packages/server/src/services/AuditService.ts";
import { UsageServiceImpl } from "../../app/packages/server/src/services/UsageService.ts";
import { RuntimeInventoryService } from "../../app/packages/server/src/services/InventoryService.ts";
import { JobService } from "../../app/packages/server/src/jobs/JobService.ts";
import { HeadscaleHttpApi } from "../../app/packages/server/src/tailscale/HeadscaleHttpApi.ts";
import { TailscaleUserInviteApi } from "../../app/packages/server/src/tailscale/TailscaleUserInviteApi.ts";
import {
  mockSystemHealthService,
  noopLogger,
  TEST_CONFIG,
} from "../../app/packages/server/src/test-helpers/mocks.ts";
import { AdminAuth } from "../../app/packages/server/src/auth/AdminAuth.ts";
import { createTestDatabase } from "../../app/packages/server/src/test-helpers/testDb.ts";
import {
  type ClaimedBundle,
  DEFAULT_CLIENT_IMAGE,
  DEFAULT_HEADSCALE_URL,
  DEFAULT_INSTANCE_IMAGE,
  friendClientEnv,
  requireConfig,
  SEED_THEN_BACKUP,
  until,
} from "../helpers.ts";

// Adds a friend through the real tRPC API; the instance pod materialises in
// the cluster — zero mocks, real everything against the in-cluster headscale
// (manifests.yaml). HTTPS serve can't be proven here (headscale issues no
// certs) — that's the docker tier's job. Must run in-cluster: k8s/run.ts
// launches it as a pod. Missing config fails, never skips.
describe("Portion lifecycle over tRPC on k8s (integration)", () => {
  const INSTANCE = "p0rt1on-k8sit";
  const CLIENT_NS = "p0rt1on-integrationtest-clients";
  const CLIENT_POD = "p0rt1on-integrationtest-client";

  beforeAll(() =>
    requireConfig({
      env: ["HEADSCALE_URL", "HEADSCALE_API_KEY"],
      hint: "run via deno task test:e2e:k8s tier2 (in-cluster).",
    })
  );

  // The test's own k8s API access via the mounted SA token (CA via
  // DENO_CERT) — separate from the app's InstanceRuntime.
  const k8sApi =
    (token: string) =>
    async (method: string, path: string, body?: unknown): Promise<unknown> => {
      const res = await fetch(`https://kubernetes.default.svc${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(
          `k8s ${method} ${path} failed (${res.status}): ${await res.text()
            .catch(() => "")}`,
        );
      }
      return res.status === 204
        ? undefined
        : await res.json().catch(() => undefined);
    };

  // A backup-client pod, given only the bundle, joins the tailnet under its
  // friend tag and runs Kopia through `tailscale serve` — the friend-facing
  // path. Must run before rotate revokes the claimed keys.
  const backupOverTailnet = async (
    k8s: ReturnType<typeof k8sApi>,
    mc: McShellClientFactory,
    token: string,
    headscaleUrl: string,
    bundle: ClaimedBundle,
  ): Promise<void> => {
    await k8s("POST", `/api/v1/namespaces/${CLIENT_NS}/pods`, {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: CLIENT_POD, namespace: CLIENT_NS },
      spec: {
        restartPolicy: "Never",
        containers: [{
          name: "client",
          image: Deno.env.get("CLIENT_IMAGE") ?? DEFAULT_CLIENT_IMAGE,
          // The pod's exit status is Kopia's.
          command: ["sh", "-c", SEED_THEN_BACKUP],
          env: Object.entries(friendClientEnv(bundle, {
            PAYLOAD: "p0rt1on-canary",
            TAILSCALE_LOGIN_SERVER: headscaleUrl,
          })).map(([name, value]) => ({ name, value })),
        }],
      },
    });

    // Kopia is one-shot: poll for the pod's terminal phase (~2min budget
    // covers enrollment + repo create + snapshot).
    const phase = await until("client pod terminal phase", async () => {
      const pod = await k8s(
        "GET",
        `/api/v1/namespaces/${CLIENT_NS}/pods/${CLIENT_POD}`,
      ) as { status?: { phase?: string } };
      const p = pod.status?.phase;
      return p === "Succeeded" || p === "Failed" ? p : null;
    }, 60).catch(() => "Pending");
    if (phase !== "Succeeded") {
      const logRes = await fetch(
        `https://kubernetes.default.svc/api/v1/namespaces/${CLIENT_NS}` +
          `/pods/${CLIENT_POD}/log?tailLines=100`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      console.error(
        "backup-client log:",
        logRes.ok ? await logRes.text() : "<no log>",
      );
    }
    expect(phase).toBe("Succeeded");

    // The friend's Kopia repo actually landed objects in the bucket —
    // written over the tailnet, through serve, with the bundle keys.
    const du = await mc
      .forInstance({ alias: INSTANCE, minioPort: 9000 })
      .du(bundle.bucket);
    expect(du.objectCount).toBeGreaterThan(0);
  };

  it(
    "addStart creates the pod; rotate + offboard leave it clean",
    async () => {
      const namespace = Deno.env.get("K8S_NAMESPACE") ?? "p0rt1on";
      const token = Deno.readTextFileSync(
        "/var/run/secrets/kubernetes.io/serviceaccount/token",
      ).trim();
      const k8s = k8sApi(token);
      const headscaleUrl = Deno.env.get("HEADSCALE_URL") ??
        DEFAULT_HEADSCALE_URL;
      const runtime = new KubernetesRuntime(
        {
          namespace,
          dataSize: "50Mi",
          stateSize: "10Mi",
          // k3d's local-path class stands in for the pantry — this tier tests
          // provisioning, not storage classes.
          pantryStorageClass: "local-path",
          // The instance joins the local headscale tailnet; headscale issues
          // no HTTPS certs, so serve falls back to plain HTTP.
          tailscale: { loginServer: headscaleUrl, serveMode: "http" },
        },
        // In-cluster: auto-detect the mounted SA (token + CA + server).
        await buildRestClient({}),
      );
      const keyGen = new CryptoKeyGen("k8s-integrationtest-master-key");
      const runner = new DenoCommandRunner();
      // /app is read-only for the runner pod's non-root uid — write temp
      // files (mc policy JSON, smoke objects) under /tmp instead.
      const tempFiles = new DenoTempFiles("/tmp/p0rt1on-tmp");
      const mc = new McShellClientFactory(
        runner,
        tempFiles,
        keyGen,
        (t) => runtime.adminEndpoint(t.alias, t.minioPort),
      );
      const database = createTestDatabase();
      const queries = new FriendQueries(database.db);
      const repo = new DrizzleProvisioningRepo(database.db, {
        portRange: { min: 9000, max: 9010 },
        serveNodeTag: "tag:p0rt1on-serve",
      });
      // Real control plane: keys minted here are live — the instance pod
      // redeems its serve key against this server.
      const tailscale = new HeadscaleHttpApi({
        baseUrl: headscaleUrl,
        apiKey: Deno.env.get("HEADSCALE_API_KEY") ?? "",
        user: "p0rt1on",
        baseDomain: "hs.test",
      });
      // Unconfigured: auth-key enrollment only, no invite path.
      const userInvite = new TailscaleUserInviteApi({});
      const logger = noopLogger();
      const config = {
        ...TEST_CONFIG,
        instanceImage: Deno.env.get("INSTANCE_IMAGE") ??
          DEFAULT_INSTANCE_IMAGE,
        // Headscale serves over HTTP (no certs); the friend endpoint is the
        // node's live tailnet IP, so no MagicDNS base domain is configured.
        serveMode: "http" as const,
      };
      // Mirrors app.ts wiring with the runtime + headscale swaps.
      const context: TrpcContext = {
        friendService: new FriendServiceImpl(
          queries,
          repo,
          mc,
          tailscale,
          config.serveMode,
          logger,
        ),
        provisioningService: new ProvisioningService(
          config,
          repo,
          mc,
          runtime,
          tailscale,
          userInvite,
          keyGen,
          new McSmokeTester(runner, tempFiles),
          logger,
        ),
        usageService: new UsageServiceImpl(queries),
        activityService: new ActivityServiceImpl(queries),
        auditService: new AuditServiceImpl(queries, repo),
        inventoryService: new RuntimeInventoryService(
          queries,
          runtime,
          logger,
        ),
        systemHealthService: mockSystemHealthService(),
        jobService: new JobService(logger),
        capabilities: { inviteApiConfigured: userInvite.configured },
        auth: AdminAuth.disabled(),
        logger,
      };
      const caller = createCallerFactory(appRouter)(context);

      // Drive `mc` as the friend with the bundle creds (env-scoped, nothing
      // on argv). Returns the result instead of throwing — the refusal IS the
      // assertion.
      const asFriend = (
        cred: { s3AccessKeyId: string; s3SecretKey: string },
        args: (alias: string) => string[],
      ) => {
        const alias = `p0rt1on-neg-${crypto.randomUUID().slice(0, 8)}`;
        return runner.run(
          "mc",
          args(alias),
          mcHostEnv(alias, runtime.adminEndpoint(INSTANCE, 9000), {
            accessKeyId: cred.s3AccessKeyId,
            secretKey: cred.s3SecretKey,
          }),
        );
      };

      try {
        // ADD via the API: the mutation detaches a job; the pod, bucket,
        // scoped user, smoke test, retention and quota all happen behind it.
        const { jobId } = await caller.friends.addStart({
          name: "k8sit",
          isolationMode: "dedicated",
          quotaBytes: 10 * 1024 * 1024,
          retentionDays: 1,
          lockMode: "GOVERNANCE",
        });
        const events = await Array.fromAsync(
          await caller.jobs.progress({ jobId }),
        );
        if (events.at(-1)?.type !== "done") {
          // Surface WHICH step failed and why — the assertion alone hides it.
          console.error("add job events:", JSON.stringify(events, null, 2));
        }
        expect(events.at(-1)?.type).toBe("done");

        // The pod exists in the cluster BECAUSE of the API call.
        expect(await runtime.listInstances()).toContainEqual({
          name: INSTANCE,
          state: "running",
        });
        expect(await runtime.instanceHealth(INSTANCE)).toBe("healthy");

        // ...and its tailscaled ACTUALLY enrolled on the headscale tailnet
        // (healthy already implies `tailscale status` = Running in-pod).
        expect(await tailscale.isNodeOnline(TEST_CONFIG.serveNodeTag))
          .toBe(true);

        // The once-shown bundle is claimable exactly once.
        const bundle = await caller.jobs.claimBundle({ jobId });
        expect(bundle.s3SecretKey.length).toBeGreaterThan(0);

        const friends = await caller.friends.list();
        const friendId = friends[0].id;
        expect(friends[0].status).toBe("active");

        // The friend backs up for real over the tailnet (see helper above).
        await backupOverTailnet(k8s, mc, token, headscaleUrl, bundle);

        // Ransomware guard: `rm` only writes a delete marker; destroying
        // versions needs s3:DeleteObjectVersion (never granted) plus
        // BypassGovernanceRetention (denied). The canary is written after
        // retention is armed — Kopia's own churn proves nothing.
        const canary = `ransom-canary-${crypto.randomUUID().slice(0, 8)}`;
        const canaryFile = await tempFiles.write(canary);
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

          // The refusal is only half of it — prove the bytes are still there.
          const read = await asFriend(bundle, (a) => [
            "cat",
            `${a}/${bundle.bucket}/${canary}`,
          ]);
          expect(read.code).toBe(0);
          expect(read.stdout.trim()).toBe(canary);
        } finally {
          await tempFiles.remove(canaryFile);
        }

        // Negative path — the quota makes this a *portion*: a write past the
        // 10 MiB set at addStart must be refused, or a friend can fill the
        // host.
        const oversizeFile = await tempFiles.write(
          "x".repeat(11 * 1024 * 1024),
        );
        try {
          const overQuota = await asFriend(bundle, (a) => [
            "cp",
            oversizeFile,
            `${a}/${bundle.bucket}/oversize`,
          ]);
          expect(overQuota.code).not.toBe(0);
        } finally {
          await tempFiles.remove(oversizeFile);
        }

        // ROTATE via the API: create-before-remove against the live MinIO.
        const rotated = await caller.friends.rotateKey({ friendId });
        expect(rotated.s3AccessKeyId).not.toBe(bundle.s3AccessKeyId);
        // A DIFFERENT key is not a REVOKED key: rotation exists because the
        // old credential is presumed compromised, so prove the old one is
        // dead...
        expect(
          (await asFriend(bundle, (a) => ["ls", `${a}/${bundle.bucket}`])).code,
        ).not.toBe(0);
        // ...and that rotation did not just break access for everyone.
        expect(
          (await asFriend(rotated, (a) => ["ls", `${a}/${bundle.bucket}`]))
            .code,
        ).toBe(0);

        // OFFBOARD via the API: full teardown, then the cluster is clean.
        const off = await caller.friends.offboardStart({ friendId });
        const offEvents = await Array.fromAsync(
          await caller.jobs.progress({ jobId: off.jobId }),
        );
        expect(offEvents.at(-1)?.type).toBe("done");
        expect(await runtime.listInstances()).toEqual([]);
        expect(await caller.friends.list()).toEqual([]);
        // Offboard removed BOTH tailnet nodes: the instance's serve node and
        // the friend's client node (revoked by the friend tag).
        expect(await tailscale.nodesByTag(TEST_CONFIG.serveNodeTag))
          .toEqual([]);
        expect(await tailscale.nodesByTag("tag:p0rt1on-friend-k8sit"))
          .toEqual([]);

        // Leak check: listInstances() only sees StatefulSets — a surviving
        // data PVC would outlive the offboard (disk leak + retention
        // problem). Fetched by name: the SA has `get` but not `list` (tier 1
        // asserts that), so listing would 403. 404 or a set deletionTimestamp
        // both count — k8s deletion is async, and a PVC in Terminating is not
        // a leak.
        const cleanedUp = async (kind: string, name: string) => {
          const res = await fetch(
            `https://kubernetes.default.svc/api/v1/namespaces/${namespace}` +
              `/${kind}/${name}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (res.status === 404) {
            await res.body?.cancel();
            return true;
          }
          const obj = await res.json() as {
            metadata?: { deletionTimestamp?: string };
          };
          return obj.metadata?.deletionTimestamp !== undefined;
        };

        expect(await cleanedUp("persistentvolumeclaims", `${INSTANCE}-data`))
          .toBe(true);
        expect(await cleanedUp("persistentvolumeclaims", `${INSTANCE}-state`))
          .toBe(true);
        expect(await cleanedUp("secrets", `${INSTANCE}-creds`)).toBe(true);
        expect(await cleanedUp("services", INSTANCE)).toBe(true);
      } finally {
        // Best-effort teardown if any step failed mid-way.
        await k8s(
          "DELETE",
          `/api/v1/namespaces/${CLIENT_NS}/pods/${CLIENT_POD}`,
        ).catch(() => undefined);
        await runtime.removeInstance(INSTANCE, { removeData: true })
          .catch(() => undefined);
        database.driver.close();
      }
    },
  );
});
