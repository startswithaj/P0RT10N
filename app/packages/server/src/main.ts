import { openDatabase } from "./db/Database.ts";
import { runMigrations } from "./db/MigrationRunner.ts";
import { ConsoleLogger } from "./lib/ConsoleLogger.ts";
import { CryptoKeyGen } from "./provisioning/CryptoKeyGen.ts";
import { Env, EVENT_BIND_HOST, EVENT_PORT } from "./lib/Env.ts";
import { FriendQueries } from "./db/FriendQueries.ts";
import { buildApp } from "./app.ts";
import { runBoot } from "./boot/boot.ts";
import { startMinioEventServer, startServer } from "./server.ts";
import { UsageSampler } from "./minio-events/UsageSampler.ts";
import { MinioEventBus } from "./minio-events/MinioEventBus.ts";
import { MinioEventAggregator } from "./minio-events/MinioEventAggregator.ts";
import { MinioEventForwarder } from "./minio-events/MinioEventForwarder.ts";
import { parseMinioEvents } from "./minio-events/parseMinioEvent.ts";
import {
  type FriendLookup,
  resolveFriend,
} from "./minio-events/resolveFriend.ts";

// Entry point: reads env, opens the database, wires services, then runs the boot sequence.
// The exact ordering (migrate, flip stale provisioning, reconcile, sweep, serve) lives in boot.ts.

const env = new Env(); // Validates required vars; refuses to boot when any are missing.
const distDir = `${import.meta.dirname}/../dist`;
const staticDir = await Deno.stat(distDir)
  .then((s) => s.isDirectory ? distDir : undefined)
  .catch(() => undefined);
const logger = new ConsoleLogger({ level: env.logLevel });
logger.info("p0rt1on starting", { level: env.logLevel, pid: Deno.pid });

logger.debug("opening database", { dbPath: env.dbPath });
const database = openDatabase(env.dbPath);

const app = await buildApp(database, env, logger);
const context = app.context;

const queries = new FriendQueries(database.db);
const lookup: FriendLookup = (bucket) => queries.friendByBucket(bucket);

// The bus owns the shared shutdown signal: SIGTERM aborts it, tearing down every subscription.
// Each consumer catches its own errors and never rejects.
const consumersAbort = new AbortController();
const bus = new MinioEventBus(logger, consumersAbort);

const friendEvents = (name: string) =>
  bus.subscribe(name)
    .pipe(parseMinioEvents)
    .pipe(resolveFriend(lookup));

const sampler = new UsageSampler(
  friendEvents("sampler"),
  queries,
  app.mcFactory,
  logger,
);
new MinioEventAggregator(friendEvents("aggregator"), database.db, logger);

if (env.minioForwardUrl) {
  new MinioEventForwarder(
    bus.subscribe("forwarder"),
    { url: env.minioForwardUrl, authorization: env.minioForwardAuthorization },
    logger,
  );
}

const sweep = () =>
  context.provisioningService.sweepFailed()
    // Same cadence: cap the append-only usage-sample history.
    .then(() => queries.pruneUsage())
    .catch((err) =>
      logger.error("cleanup sweep failed", { error: String(err) })
    );

await runBoot({
  migrate: () => runMigrations(database.driver, logger),
  recoverStaleProvisioning: () =>
    context.provisioningService.recoverStaleProvisioning(),
  // Degraded instances are marked and logged inside the reconciler.
  // Any failure there is logged but never fatal, because the admin UI must come up to show the problem.
  reconcile: () =>
    app.bootReconciler.run().catch((err) =>
      logger.error("boot reconcile failed", { error: String(err) })
    ),
  sweep,
  // Probes tailnet prerequisites so the UI can gate portion creation.
  // Failures are logged but never fatal, because the admin UI must come up to surface the problem.
  preflight: () =>
    context.systemHealthService.probe()
      .then((h) => {
        if (h.canProvision) {
          logger.info("preflight ok", { checks: h.checks.length });
        } else {
          logger.warn("preflight found blocking issues", {
            blocked: h.checks
              .filter((c) => c.status === "blocked")
              .map((c) => c.id),
          });
        }
      })
      .catch((err) =>
        logger.error("preflight probe failed", { error: String(err) })
      ),
  serve: () => {
    // Reap tombstones every 10 min after the boot-time pass.
    setInterval(sweep, 10 * 60 * 1000);

    // Usage samples: once now (dashboard never empty after a restart) and
    // hourly as the idle baseline; the audit debounce covers active friends.
    const sampleAll = () =>
      sampler.sampleAll().catch((err) =>
        logger.error("usage sampling failed", { error: String(err) })
      );

    sampleAll();
    setInterval(sampleAll, 60 * 60 * 1000);
    // Two listeners keep the exposed surface minimal: the admin API defaults to
    // loopback, and only the token-guarded audit webhook faces the container network.
    // This only checks the bind address, not actual exposure, since a container's host publish is invisible to it.
    // So the warning here is conditional; the UI banner, keyed on the request URL, gives the precise signal.
    const localOnly = ["127.0.0.1", "localhost", "::1"];
    if (!localOnly.includes(env.adminBindHost) && !env.adminAuth) {
      logger.warn(
        `admin API is bound to ${env.adminBindHost}:${env.port} with NO ` +
          `password set. If this host makes it reachable beyond localhost, ` +
          `anyone on your network can create or tear down backup instances. ` +
          `Set P0RT1ON_ADMIN_USERNAME and P0RT1ON_ADMIN_PASSWORD to require a ` +
          `login — or confirm it's only reachable from this machine.`,
      );
    }
    startServer({
      port: env.port,
      context,
      bindHost: env.adminBindHost,
      staticDir,
      onListen: ({ port }) =>
        logger.info(`p0rt1on admin listening on ${env.adminBindHost}:${port}`),
    });
    startMinioEventServer({
      port: EVENT_PORT,
      hostname: EVENT_BIND_HOST,
      sink: {
        // Derived from the master key. This is the same value buildApp wires into
        // setAuditWebhook, so instances and the listener always agree on it.
        token: new CryptoKeyGen(env.masterKey).auditWebhookToken(),
        onEvent: (raw) => bus.publish(raw),
      },
      onListen: ({ port }) =>
        logger.info(
          `p0rt1on minio-event webhook listening on ${EVENT_BIND_HOST}:${port}`,
        ),
    });
    Deno.addSignalListener("SIGTERM", () => {
      consumersAbort.abort();
      Deno.exit(0);
    });
  },
});
