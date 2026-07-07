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
import type { Logger } from "./services/types.ts";
import type { TrpcContext } from "./trpc/trpc.ts";

// ============================================================================
// Dependency wiring. buildContext assembles the concrete services from a DB +
// Env + logger. All env reads live on Env; nothing here touches Deno.env.
// ============================================================================

export function buildContext(
  database: Database,
  env: Env,
  logger: Logger,
): TrpcContext {
  const config = env.provisioningConfig();
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
    new CryptoKeyGen(env.requireMasterKey()),
    tempFiles,
    new McSmokeTester(runner, tempFiles),
    logger,
  );
  return {
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
}

/**
 * Real Tailscale API when `TS_API_TOKEN` is set, else the stub (so dev without a
 * tailnet still boots — provisioning just fails loudly at the tailscale steps).
 */
function buildTailscale(env: Env, logger: Logger): TailscaleApi {
  const token = env.tailscaleToken;
  if (!token) {
    logger.warn(
      "TS_API_TOKEN unset — using Tailscale stub (add/offboard fail at TS steps)",
    );
    return stubTailscale;
  }
  return new TailscaleHttpApi({
    token,
    tailnet: env.tailnet,
    tagOwner: env.tagOwner,
  });
}
