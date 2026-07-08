import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createCallerFactory } from "../trpc/trpc.ts";
import { appRouter } from "../trpc/root.ts";
import type { TrpcContext } from "../trpc/trpc.ts";
import { ProvisioningService } from "./ProvisioningService.ts";
import { KubernetesRuntime } from "../runtime/KubernetesRuntime.ts";
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
import {
  mockTailscaleApi,
  noopLogger,
  TEST_CONFIG,
} from "../test-helpers/mocks.ts";
import { createTestDatabase } from "../test-helpers/testDb.ts";

// The PORTION-level k8s integration: a friend is added THROUGH THE tRPC API
// (friends.addStart → jobs.progress → jobs.claimBundle) and the instance pod
// materialises in the cluster as a side effect — real router, real services,
// real SQLite, real `mc` (bundled in the manager image), the real instance
// image (MinIO-only via TAILSCALE_DISABLED=1) and the real KubernetesRuntime.
// Only TailscaleApi is mocked — CI clusters have no tailnet; the nightly e2e
// tier covers that half. MUST run IN-cluster (needs `mc` + cluster DNS + the
// mounted ServiceAccount): deploy/k8s/run-integration.sh launches it as a
// pod. Skipped unless P0RT1ON_K8S_PORTION_IT is set.
describe("Portion lifecycle over tRPC on k8s (integration)", () => {
  const enabled = Boolean(Deno.env.get("P0RT1ON_K8S_PORTION_IT"));
  const maybe = enabled ? it : it.ignore;

  maybe(
    "addStart creates the pod; rotate + offboard leave it clean",
    async () => {
      const namespace = Deno.env.get("K8S_NAMESPACE") ?? "p0rt1on";
      const token = Deno.readTextFileSync(
        "/var/run/secrets/kubernetes.io/serviceaccount/token",
      ).trim();
      const runtime = new KubernetesRuntime({
        namespace,
        token,
        dataSize: "50Mi",
        stateSize: "10Mi",
      });
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
      // The only fake: CI clusters have no tailnet. Its minted keys are inert
      // (tailscaled is disabled in the instance image for this tier).
      const tailscale = mockTailscaleApi([]);
      const logger = noopLogger();
      const config = {
        ...TEST_CONFIG,
        instanceImage: Deno.env.get("INSTANCE_IMAGE") ??
          "p0rt1on-instance:it-notail",
      };
      // Mirrors app.ts wiring with the two swaps (k8s runtime, mock tailscale).
      const context: TrpcContext = {
        friendService: new FriendServiceImpl(
          queries,
          repo,
          mc,
          tailscale,
          config.tailnetDomain,
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

        // The once-shown bundle is claimable exactly once.
        const bundle = await caller.jobs.claimBundle({ jobId });
        expect(bundle.s3SecretKey.length).toBeGreaterThan(0);

        const friends = await caller.friends.list();
        const friendId = friends[0].id;
        expect(friends[0].status).toBe("active");

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
      } finally {
        // Best-effort teardown if any step failed mid-way.
        await runtime.removeInstance("p0rt1on-k8sit", { removeData: true })
          .catch(() => undefined);
        database.driver.close();
      }
    },
  );
});
