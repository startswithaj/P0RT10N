import type { Database } from "./db/Database.ts";
import { FriendQueries } from "./db/FriendQueries.ts";
import { DrizzleProvisioningRepo } from "./db/ProvisioningRepo.ts";
import { ProvisioningService } from "./provisioning/ProvisioningService.ts";
import { CryptoKeyGen } from "./provisioning/CryptoKeyGen.ts";
import { McSmokeTester } from "./provisioning/McSmokeTester.ts";
import { TailscaleHttpApi } from "./tailscale/TailscaleHttpApi.ts";
import { HeadscaleHttpApi } from "./tailscale/HeadscaleHttpApi.ts";
import { TailscaleUserInviteApi } from "./tailscale/TailscaleUserInviteApi.ts";
import type { TailscaleApi } from "./tailscale/tailscale.ts";
import { McShellClientFactory } from "./minio/McShellClient.ts";
import {
  DOCKER_NETWORK,
  DockerInstanceRuntime,
  DockerRuntime,
} from "./runtime/DockerRuntime.ts";
import { HostPantry } from "./runtime/pantry.ts";
import {
  buildRestClient,
  KubernetesRuntime,
} from "./runtime/KubernetesRuntime.ts";
import type { InstanceRuntime } from "./runtime/runtime.ts";
import { DenoCommandRunner, DenoTempFiles } from "./lib/CommandRunner.ts";
import { denoPortProbe } from "./lib/net.ts";
import type { Env } from "./lib/Env.ts";
import {
  ActivityServiceImpl,
  AuditServiceImpl,
  FriendServiceImpl,
  UsageServiceImpl,
} from "./services/DbServices.ts";
import { RuntimeInventoryService } from "./services/InventoryService.ts";
import { JobService } from "./jobs/JobService.ts";
import { BootReconciler } from "./boot/BootReconciler.ts";
import { AdminAuth } from "./auth/AdminAuth.ts";
import type { Logger } from "./services/types.ts";
import type { TrpcContext } from "./trpc/trpc.ts";

// ============================================================================
// Dependency wiring. buildApp assembles the concrete services from a DB +
// Env + logger. All env reads live on Env; nothing here touches Deno.env.
// ============================================================================

/** Everything main.ts needs: the request context + the boot-only pieces. */
export interface App {
  context: TrpcContext;
  bootReconciler: BootReconciler;
  /** Shared mc factory (the usage sampler in main.ts needs per-instance clients). */
  mcFactory: McShellClientFactory;
}

/** P0RT1ON_RUNTIME=docker (default) or kubernetes — the only branch point. */
async function buildInstanceRuntime(
  env: Env,
  runner: DenoCommandRunner,
  tempFiles: DenoTempFiles,
): Promise<InstanceRuntime> {
  if (env.runtimeKind === "kubernetes") {
    const settings = env.kubeSettings();
    // No explicit overrides → the client auto-detects the mounted in-cluster
    // ServiceAccount (token + CA + server); dev passes P0RT1ON_K8S_API and
    // P0RT1ON_K8S_TOKEN.
    const client = await buildRestClient({
      apiBase: settings.apiBase,
      token: settings.tokenInline,
      caCert: settings.caFile
        ? Deno.readTextFileSync(settings.caFile)
        : undefined,
    });
    return new KubernetesRuntime({
      namespace: settings.namespace,
      dataSize: settings.dataSize,
      stateSize: settings.stateSize,
      pantryStorageClass: env.pantry,
      tailscale: env.instanceTailscale(),
      resources: settings.resources,
    }, client);
  }
  return new DockerInstanceRuntime(new DockerRuntime(runner), tempFiles, {
    network: DOCKER_NETWORK,
    addressing: env.provisioningConfig().instanceAddressing,
    pantry: new HostPantry(env.pantry),
    tailscale: env.instanceTailscale(),
    resources: env.dockerPortionResources(),
  });
}

/** P0RT1ON_TAILSCALE_BACKEND=tailscale (default) or headscale — the only place
 * this branches. Headscale is the self-hosted test-tier control plane. */
function buildTailscaleApi(env: Env): TailscaleApi {
  if (env.tailscaleBackend === "headscale") {
    return new HeadscaleHttpApi({
      ...env.headscaleSettings(),
      tagOwner: env.tagOwner,
    });
  }
  return new TailscaleHttpApi({
    token: env.tailscaleOauthClientSecret,
    tagOwner: env.tagOwner,
  });
}

/** Request-scoped wiring only — the common case for routers and tests. */
export async function buildContext(
  database: Database,
  env: Env,
  logger: Logger,
): Promise<TrpcContext> {
  return (await buildApp(database, env, logger)).context;
}

export async function buildApp(
  database: Database,
  env: Env,
  logger: Logger,
): Promise<App> {
  const keyGen = new CryptoKeyGen(env.masterKey);
  // The audit token is derived from the master key, not env-sourced.
  const config = {
    ...env.provisioningConfig(),
    auditWebhookToken: keyGen.auditWebhookToken(),
  };
  const queries = new FriendQueries(database.db);
  const repo = new DrizzleProvisioningRepo(database.db, {
    portRange: config.portRange,
    serveNodeTag: config.serveNodeTag,
    // Instances publish to the HOST loopback — a containerized manager's own
    // netns says nothing about those ports, so only probe when host-run.
    // Under k8s there are no host ports at all (the allocated port is just
    // the in-pod MinIO listen port), so probing is meaningless there too.
    probePort:
      env.runtimeKind === "docker" && config.instanceAddressing === "host"
        ? denoPortProbe()
        : undefined,
  });
  const runner = new DenoCommandRunner();
  const tempFiles = new DenoTempFiles();
  const instanceRuntime = await buildInstanceRuntime(env, runner, tempFiles);
  const mcFactory = new McShellClientFactory(
    runner,
    tempFiles,
    keyGen,
    // Only the runtime knows how to address an instance's admin plane.
    (t) => instanceRuntime.adminEndpoint(t.alias, t.minioPort),
  );
  const tailscale = buildTailscaleApi(env);
  const userInvite = new TailscaleUserInviteApi({
    token: env.tailscaleApiToken,
  });
  const provisioningService = new ProvisioningService(
    config,
    repo,
    mcFactory,
    instanceRuntime,
    tailscale,
    userInvite,
    keyGen,
    new McSmokeTester(runner, tempFiles),
    logger,
  );
  // Env credentials → hashed auth at boot; absent → disabled (loopback only).
  const adminCreds = env.adminAuth;
  const auth = adminCreds
    ? await AdminAuth.create(adminCreds)
    : AdminAuth.disabled();
  const context: TrpcContext = {
    friendService: new FriendServiceImpl(
      queries,
      repo,
      mcFactory,
      tailscale,
      config.tailnetDomain,
      config.serveMode,
      logger,
    ),
    provisioningService,
    usageService: new UsageServiceImpl(queries),
    activityService: new ActivityServiceImpl(queries),
    auditService: new AuditServiceImpl(queries, repo),
    inventoryService: new RuntimeInventoryService(
      queries,
      instanceRuntime,
      config.tailnetDomain,
      logger,
    ),
    jobService: new JobService(logger),
    capabilities: { inviteApiConfigured: userInvite.configured },
    auth,
    logger,
  };
  return {
    context,
    mcFactory,
    bootReconciler: new BootReconciler(
      repo,
      instanceRuntime,
      provisioningService,
      logger,
    ),
  };
}
