import type { Database } from "./db/Database.ts";
import { FriendQueries } from "./db/FriendQueries.ts";
import { DrizzleProvisioningRepo } from "./db/ProvisioningRepo.ts";
import { ProvisioningService } from "./provisioning/ProvisioningService.ts";
import type {
  ProvisioningConfig,
  ProvisioningRepo,
} from "./provisioning/deps.ts";
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
import { FriendServiceImpl } from "./services/FriendService.ts";
import { HostnameHealthChecker } from "./provisioning/HostnameHealthChecker.ts";
import { ActivityServiceImpl } from "./services/ActivityService.ts";
import { AuditServiceImpl } from "./services/AuditService.ts";
import { UsageServiceImpl } from "./services/UsageService.ts";
import { RuntimeInventoryService } from "./services/InventoryService.ts";
import {
  buildHealthProbes,
  SystemHealthServiceImpl,
} from "./services/SystemHealthService.ts";
import { MinioEventBus } from "./minio-events/MinioEventBus.ts";
import { MinioEventAggregator } from "./minio-events/MinioEventAggregator.ts";
import { MinioEventForwarder } from "./minio-events/MinioEventForwarder.ts";
import { UsageSampler } from "./minio-events/UsageSampler.ts";
import { parseMinioEvents } from "./minio-events/parseMinioEvent.ts";
import {
  type FriendLookup,
  resolveFriend,
} from "./minio-events/resolveFriend.ts";
import { JobService } from "./jobs/JobService.ts";
import { BootReconciler } from "./boot/BootReconciler.ts";
import { AdminAuth } from "./auth/AdminAuth.ts";
import type { Logger } from "./services/types.ts";
import type { TrpcContext } from "./trpc/trpc.ts";
import type { RestClient } from "@cloudydeno/kubernetes-client";

// All env reads go through Env; nothing here touches Deno.env directly.

/** buildApp is the single composition root: every dependency is constructed
 * here. main.ts owns lifecycle only — boot, timers, servers, signals — so
 * "where does X come from" has exactly one answer. */
export interface App {
  context: TrpcContext;
  bootReconciler: BootReconciler;
  /** Sampled on a timer by main.ts. */
  sampler: UsageSampler;
  /** Used by the cleanup sweep to prune usage history. */
  queries: FriendQueries;
  /** The MinIO webhook server publishes raw events into this. */
  bus: MinioEventBus;
  /** Aborted on SIGTERM, tearing down every event subscription. */
  consumersAbort: AbortController;
  /** Derived from the master key; the webhook listener authenticates with it.
   * Same value baked into each instance's audit-webhook env at creation. */
  auditWebhookToken: string;
}

/** Built once and reused for both the runtime and the boot-time health
 * probes below, rather than opening a second connection to the API server. */
function buildKubeClient(env: Env): Promise<RestClient> {
  const settings = env.kubeSettings();
  return buildRestClient({
    apiBase: settings.apiBase,
    token: settings.tokenInline,
    caCert: settings.caFile
      ? Deno.readTextFileSync(settings.caFile)
      : undefined,
  });
}

function buildKubernetesInstanceRuntime(
  env: Env,
  kubeClient: RestClient,
): InstanceRuntime {
  const settings = env.kubeSettings();
  return new KubernetesRuntime({
    namespace: settings.namespace,
    dataSize: settings.dataSize,
    stateSize: settings.stateSize,
    pantryStorageClass: env.pantry,
    tailscale: env.instanceTailscale(),
    resources: settings.resources,
  }, kubeClient);
}

function buildDockerInstanceRuntime(
  env: Env,
  runner: DenoCommandRunner,
  tempFiles: DenoTempFiles,
): InstanceRuntime {
  return new DockerInstanceRuntime(new DockerRuntime(runner), tempFiles, {
    network: DOCKER_NETWORK,
    addressing: env.provisioningConfig().instanceAddressing,
    pantry: new HostPantry(env.pantry),
    tailscale: env.instanceTailscale(),
    resources: env.dockerPortionResources(),
  });
}

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

function buildHostnameChecker(
  repo: ProvisioningRepo,
  tailscale: TailscaleApi,
  config: ProvisioningConfig,
): HostnameHealthChecker {
  return new HostnameHealthChecker(repo, tailscale, config.serveNodeTag);
}

/** The MinIO event pipeline. The bus owns the shared shutdown signal: aborting
 * it tears down every subscription. Each consumer catches its own errors and
 * never rejects, and each gets its OWN subscription. */
function buildEventPipeline(
  database: Database,
  env: Env,
  logger: Logger,
  queries: FriendQueries,
  mcFactory: McShellClientFactory,
): {
  bus: MinioEventBus;
  consumersAbort: AbortController;
  aggregator: MinioEventAggregator;
  sampler: UsageSampler;
} {
  const consumersAbort = new AbortController();
  const bus = new MinioEventBus(logger, consumersAbort);
  const lookup: FriendLookup = (bucket) => queries.friendByBucket(bucket);

  const friendEvents = (name: string) =>
    bus.subscribe(name).pipe(parseMinioEvents).pipe(resolveFriend(lookup));

  if (env.minioForwardUrl) {
    new MinioEventForwarder(
      bus.subscribe("forwarder"),
      {
        url: env.minioForwardUrl,
        authorization: env.minioForwardAuthorization,
      },
      logger,
    );
  }

  return {
    bus,
    consumersAbort,
    // Provisioning reads a friend's activity through the aggregator to confirm
    // the audit webhook reached the manager, then clears it.
    aggregator: new MinioEventAggregator(
      friendEvents("aggregator"),
      database.db,
      logger,
    ),
    sampler: new UsageSampler(
      friendEvents("sampler"),
      queries,
      mcFactory,
      logger,
    ),
  };
}

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
    // Instances publish to the host's loopback interface; a containerized manager can't
    // see those ports from its own network namespace, so probing only applies when running on the host.
    // Kubernetes has no host ports at all, so probing is skipped there too.
    probePort:
      env.runtimeKind === "docker" && config.instanceAddressing === "host"
        ? denoPortProbe()
        : undefined,
  }, logger);
  const runner = new DenoCommandRunner();
  const tempFiles = new DenoTempFiles();
  // Built once, upfront, and shared by the runtime and the health probes below.
  const kubeClient = env.runtimeKind === "kubernetes"
    ? await buildKubeClient(env)
    : undefined;
  const instanceRuntime = kubeClient
    ? buildKubernetesInstanceRuntime(env, kubeClient)
    : buildDockerInstanceRuntime(env, runner, tempFiles);
  const mcFactory = new McShellClientFactory(
    runner,
    tempFiles,
    keyGen,
    (t) => instanceRuntime.adminEndpoint(t.alias, t.minioPort),
  );
  const tailscale = buildTailscaleApi(env);
  const userInvite = new TailscaleUserInviteApi({
    token: env.tailscaleApiToken,
  });

  const events = buildEventPipeline(database, env, logger, queries, mcFactory);
  const hostnameChecker = buildHostnameChecker(repo, tailscale, config);

  const provisioningService = new ProvisioningService(
    config,
    repo,
    mcFactory,
    instanceRuntime,
    tailscale,
    userInvite,
    keyGen,
    new McSmokeTester(runner, tempFiles),
    events.aggregator,
    logger,
  );
  // Env credentials become hashed auth at boot; if absent, auth is disabled.
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
      config.serveMode,
      hostnameChecker,
      logger,
    ),
    provisioningService,
    usageService: new UsageServiceImpl(queries),
    activityService: new ActivityServiceImpl(queries),
    auditService: new AuditServiceImpl(queries, repo),
    inventoryService: new RuntimeInventoryService(
      queries,
      instanceRuntime,
      logger,
    ),
    systemHealthService: new SystemHealthServiceImpl(
      tailscale,
      {
        serveMode: config.serveMode,
        serveNodeTag: config.serveNodeTag,
        aclMode: config.aclMode,
        runtimeKind: env.runtimeKind,
        instanceImage: config.instanceImage,
        ...buildHealthProbes(env, kubeClient),
      },
      logger,
    ),
    jobService: new JobService(logger),
    capabilities: { inviteApiConfigured: userInvite.configured },
    auth,
    logger,
  };
  return {
    context,
    queries,
    sampler: events.sampler,
    bus: events.bus,
    consumersAbort: events.consumersAbort,
    auditWebhookToken: config.auditWebhookToken,
    bootReconciler: new BootReconciler(
      repo,
      instanceRuntime,
      provisioningService,
      logger,
    ),
  };
}
