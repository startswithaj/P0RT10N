import type { Database } from "./db/Database.ts";
import { FriendQueries } from "./db/FriendQueries.ts";
import { DrizzleProvisioningRepo } from "./db/ProvisioningRepo.ts";
import { ProvisioningService } from "./provisioning/ProvisioningService.ts";
import { CryptoKeyGen } from "./provisioning/CryptoKeyGen.ts";
import { McSmokeTester } from "./provisioning/McSmokeTester.ts";
import { stubTailscale } from "./provisioning/stubs.ts";
import { TailscaleHttpApi } from "./tailscale/TailscaleHttpApi.ts";
import type { TailscaleApi } from "./tailscale/tailscale.ts";
import { McShellClientFactory } from "./minio/McShellClient.ts";
import {
  DockerInstanceRuntime,
  DockerRuntime,
} from "./runtime/DockerRuntime.ts";
import { DenoCommandRunner, DenoTempFiles } from "./lib/CommandRunner.ts";
import type { Env } from "./lib/Env.ts";
import {
  ActivityServiceImpl,
  FriendServiceImpl,
  UsageServiceImpl,
} from "./services/DbServices.ts";
import { RuntimeInventoryService } from "./services/InventoryService.ts";
import { JobService } from "./jobs/JobService.ts";
import { BootReconciler } from "./boot/BootReconciler.ts";
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
}

/** Request-scoped wiring only — the common case for routers and tests. */
export function buildContext(
  database: Database,
  env: Env,
  logger: Logger,
): TrpcContext {
  return buildApp(database, env, logger).context;
}

export function buildApp(
  database: Database,
  env: Env,
  logger: Logger,
): App {
  const keyGen = new CryptoKeyGen(env.requireMasterKey());
  // The audit token is derived from the master key, not env-sourced.
  const config = {
    ...env.provisioningConfig(),
    auditWebhookToken: keyGen.auditWebhookToken(),
  };
  const queries = new FriendQueries(database.db);
  const repo = new DrizzleProvisioningRepo(database.db, {
    portRange: config.portRange,
    serveNodeTag: config.serveNodeTag,
  });
  const runner = new DenoCommandRunner();
  const tempFiles = new DenoTempFiles();
  const mcFactory = new McShellClientFactory(runner, tempFiles);
  const tailscale = buildTailscale(env, logger);
  const containerRuntime = new DockerRuntime(runner);
  const provisioningService = new ProvisioningService(
    config,
    repo,
    mcFactory,
    new DockerInstanceRuntime(containerRuntime),
    tailscale,
    keyGen,
    tempFiles,
    new McSmokeTester(runner, tempFiles),
    logger,
  );
  const context: TrpcContext = {
    friendService: new FriendServiceImpl(
      queries,
      repo,
      mcFactory,
      tailscale,
      config.tailnetDomain,
      logger,
    ),
    provisioningService,
    usageService: new UsageServiceImpl(queries),
    activityService: new ActivityServiceImpl(queries),
    inventoryService: new RuntimeInventoryService(
      queries,
      containerRuntime,
      config.tailnetDomain,
      logger,
    ),
    jobService: new JobService(logger),
    logger,
  };
  return {
    context,
    bootReconciler: new BootReconciler(
      repo,
      containerRuntime,
      mcFactory,
      keyGen,
      {
        instanceHost: config.instanceHost,
        auditWebhookUrl: config.auditWebhookUrl,
        auditWebhookToken: config.auditWebhookToken,
      },
      logger,
    ),
  };
}

/**
 * Real Tailscale API when `TAILSCALE_OAUTH_CLIENT_SECRET` is set, else the stub
 * (so dev without a tailnet still boots — provisioning just fails loudly at the
 * tailscale steps).
 */
function buildTailscale(env: Env, logger: Logger): TailscaleApi {
  const token = env.tailscaleOauthClientSecret;
  if (!token) {
    logger.warn(
      "TAILSCALE_OAUTH_CLIENT_SECRET unset — using Tailscale stub (add/offboard fail at TS steps)",
    );
    return stubTailscale;
  }
  return new TailscaleHttpApi({
    token,
    tagOwner: env.tagOwner,
  });
}
