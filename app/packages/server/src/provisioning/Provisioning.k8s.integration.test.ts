import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createCallerFactory } from "../trpc/trpc.ts";
import { appRouter } from "../trpc/root.ts";
import type { TrpcContext } from "../trpc/trpc.ts";
import { ProvisioningService } from "./ProvisioningService.ts";
import {
  buildRestClient,
  KubernetesRuntime,
} from "../runtime/KubernetesRuntime.ts";
import { CryptoKeyGen } from "./CryptoKeyGen.ts";
import { McShellClientFactory } from "../minio/McShellClient.ts";
import { McSmokeTester } from "./McSmokeTester.ts";
import { DrizzleProvisioningRepo } from "../db/ProvisioningRepo.ts";
import { FriendQueries } from "../db/FriendQueries.ts";
import { DenoCommandRunner, DenoTempFiles } from "../lib/CommandRunner.ts";
import {
  ActivityServiceImpl,
  FriendServiceImpl,
  UsageServiceImpl,
} from "../services/DbServices.ts";
import { RuntimeInventoryService } from "../services/InventoryService.ts";
import { JobService } from "../jobs/JobService.ts";
import { HeadscaleHttpApi } from "../tailscale/HeadscaleHttpApi.ts";
import { noopLogger, TEST_CONFIG } from "../test-helpers/mocks.ts";
import { createTestDatabase } from "../test-helpers/testDb.ts";

// The PORTION-level k8s integration: a friend is added THROUGH THE tRPC API
// (friends.addStart → jobs.progress → jobs.claimBundle) and the instance pod
// materialises in the cluster as a side effect — real router, real services,
// real SQLite, real `mc` (bundled in the manager image), the real instance
// image (tailscaled ENABLED) and the real KubernetesRuntime. ZERO mocks: an
// in-cluster HEADSCALE control plane (deploy/k8s/headscale-it.yaml) makes the
// tailnet real too — the preauth key is actually minted, the pod's userspace
// tailscaled actually enrolls, and offboard actually deletes the node. What
// this still can't prove: `tailscale serve` over HTTPS (headscale issues no
// certs — serve runs HTTP here) — that stays with the nightly real-tailnet
// tier. MUST run IN-cluster (needs `mc` + cluster DNS + the mounted
// ServiceAccount): deploy/k8s/run-integration.sh launches it as a pod.
// Skipped unless P0RT1ON_K8S_PORTION_IT is set.
describe("Portion lifecycle over tRPC on k8s (integration)", () => {
  const enabled = Boolean(Deno.env.get("P0RT1ON_K8S_PORTION_IT"));
  const maybe = enabled ? it : it.ignore;

  // The test's OWN k8s API access (mounted SA token + cluster CA via DENO_CERT).
  // The friend's client pod has nothing to do with the app's InstanceRuntime,
  // so launching it never touches that. Returns parsed JSON (text() elsewhere).
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

  // The friend's REAL backup over the tailnet: a backup-client pod, given ONLY
  // bundle contents, joins the SAME headscale tailnet under its friend tag and
  // runs Kopia through the instance's `tailscale serve` (WireGuard) — the
  // friend-facing path the manager never touches. Runs as ROOT in a
  // non-restricted namespace, like a friend's docker host. Must run with the
  // CLAIMED keys, i.e. before rotate revokes them.
  const backupOverTailnet = async (
    k8s: ReturnType<typeof k8sApi>,
    mc: McShellClientFactory,
    token: string,
    headscaleUrl: string,
    bundle: {
      s3Endpoint: string;
      bucket: string;
      s3AccessKeyId: string;
      s3SecretKey: string;
      tsAuthKey?: string;
    },
  ): Promise<void> => {
    const clientNs = "p0rt1on-it-clients";
    const payload = crypto.randomUUID();
    await k8s("POST", `/api/v1/namespaces/${clientNs}/pods`, {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: "p0rt1on-it-client", namespace: clientNs },
      spec: {
        restartPolicy: "Never",
        containers: [{
          name: "client",
          image: Deno.env.get("CLIENT_IMAGE") ?? "p0rt1on-backup-client:it",
          // Seed a known file, then hand off to the real entrypoint; the
          // pod's exit status is Kopia's.
          command: [
            "sh",
            "-c",
            'mkdir -p /backup && printf %s "$PAYLOAD" > ' +
            "/backup/canary.txt && exec /entrypoint.sh",
          ],
          env: [
            { name: "PAYLOAD", value: payload },
            { name: "BACKUP_PATH", value: "/backup" },
            { name: "S3_ENDPOINT", value: bundle.s3Endpoint },
            { name: "S3_BUCKET", value: bundle.bucket },
            { name: "S3_ACCESS_KEY_ID", value: bundle.s3AccessKeyId },
            { name: "S3_SECRET_ACCESS_KEY", value: bundle.s3SecretKey },
            { name: "KOPIA_PASSWORD", value: "it-kopia-pw" },
            { name: "TAILSCALE_AUTHKEY", value: bundle.tsAuthKey ?? "" },
            { name: "TAILSCALE_LOGIN_SERVER", value: headscaleUrl },
          ],
        }],
      },
    });

    // Kopia is one-shot: poll for the pod's terminal phase (~2min budget
    // covers enrollment + repo create + snapshot).
    const podPhase = async (attemptsLeft: number): Promise<string> => {
      const pod = await k8s(
        "GET",
        `/api/v1/namespaces/${clientNs}/pods/p0rt1on-it-client`,
      ) as { status?: { phase?: string } };
      const phase = pod.status?.phase ?? "Unknown";
      if (phase === "Succeeded" || phase === "Failed") return phase;
      if (attemptsLeft <= 0) return phase;
      await new Promise((r) => setTimeout(r, 2000));
      return podPhase(attemptsLeft - 1);
    };
    const phase = await podPhase(60);
    if (phase !== "Succeeded") {
      const logRes = await fetch(
        `https://kubernetes.default.svc/api/v1/namespaces/${clientNs}` +
          "/pods/p0rt1on-it-client/log?tailLines=100",
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
      .forInstance({ alias: "p0rt1on-k8sit", minioPort: 9000 })
      .du(bundle.bucket);
    expect(du.objectCount).toBeGreaterThan(0);
  };

  maybe(
    "addStart creates the pod; rotate + offboard leave it clean",
    async () => {
      const namespace = Deno.env.get("K8S_NAMESPACE") ?? "p0rt1on";
      const token = Deno.readTextFileSync(
        "/var/run/secrets/kubernetes.io/serviceaccount/token",
      ).trim();
      const k8s = k8sApi(token);
      const headscaleUrl = Deno.env.get("HEADSCALE_URL") ??
        "http://headscale.p0rt1on.svc:8080";
      const runtime = new KubernetesRuntime(
        {
          namespace,
          dataSize: "50Mi",
          stateSize: "10Mi",
          // The instance joins the local headscale tailnet; headscale issues
          // no HTTPS certs, so serve falls back to plain HTTP.
          tailscale: { loginServer: headscaleUrl, serveMode: "http" },
        },
        // In-cluster: auto-detect the mounted SA (token + CA + server).
        await buildRestClient({}),
      );
      const keyGen = new CryptoKeyGen("k8s-it-master-key");
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
      // Real control plane: the in-cluster headscale. Keys minted here are
      // live — the instance pod redeems its serve key against this server.
      const tailscale = new HeadscaleHttpApi({
        baseUrl: headscaleUrl,
        apiKey: Deno.env.get("HEADSCALE_API_KEY") ?? "",
        user: "p0rt1on",
      });
      const logger = noopLogger();
      const config = {
        ...TEST_CONFIG,
        instanceImage: Deno.env.get("INSTANCE_IMAGE") ?? "p0rt1on-instance:it",
        // Headscale serves over HTTP (no certs) and its MagicDNS base is
        // hs.test — endpoints + ACL grants must line up with the real tailnet.
        serveMode: "http" as const,
        tailnetDomain: "hs.test",
      };
      // Mirrors app.ts wiring with the runtime + headscale swaps.
      const context: TrpcContext = {
        friendService: new FriendServiceImpl(
          queries,
          repo,
          mc,
          tailscale,
          config.tailnetDomain,
          config.serveMode,
          logger,
        ),
        provisioningService: new ProvisioningService(
          config,
          repo,
          mc,
          runtime,
          tailscale,
          keyGen,
          new McSmokeTester(runner, tempFiles),
          logger,
        ),
        usageService: new UsageServiceImpl(queries),
        activityService: new ActivityServiceImpl(queries),
        inventoryService: new RuntimeInventoryService(
          queries,
          runtime,
          config.tailnetDomain,
          logger,
        ),
        jobService: new JobService(logger),
        logger,
      };
      const caller = createCallerFactory(appRouter)(context);

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
          name: "p0rt1on-k8sit",
          state: "running",
        });
        expect(await runtime.instanceHealth("p0rt1on-k8sit")).toBe("healthy");

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

        // ROTATE via the API: create-before-remove against the live MinIO.
        const rotated = await caller.friends.rotateKey({ friendId });
        expect(rotated.s3AccessKeyId).not.toBe(bundle.s3AccessKeyId);

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
      } finally {
        // Best-effort teardown if any step failed mid-way.
        await k8s(
          "DELETE",
          "/api/v1/namespaces/p0rt1on-it-clients/pods/p0rt1on-it-client",
        ).catch(() => undefined);
        await runtime.removeInstance("p0rt1on-k8sit", { removeData: true })
          .catch(() => undefined);
        database.driver.close();
      }
    },
  );
});
