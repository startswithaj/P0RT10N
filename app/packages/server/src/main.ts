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

// Server entrypoint: read env → open DB → wire services → run the boot
// sequence (migrations → stale-provisioning flip → container reconcile →
// sweep → serve; ordering lives in boot.ts where it's tested). Thin by
// design — the Deno.serve glue isn't unit-tested; app.ts wiring and the HTTP
// path have their own tests.

const env = new Env(); // validates required vars — refuses to boot without them
// The production image builds the SPA next to the server; in dev it is absent
// and the Vite dev server serves the frontend instead.
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

// MinIO events fan out from one bus to independent consumers: the aggregator
// folds per-friend activity, the sampler debounces `mc du`, the forwarder ships
// raw payloads to the operator's webhook. Metrics consumers read the parsed,
// friend-resolved stream; none depend on another. Usage samples also run at
// boot + hourly (below); the sampler's stream subscription covers active
// friends (30s after a friend's last event).
// The bus owns the shared shutdown signal — SIGTERM aborts it, tearing down
// every subscription.
const consumersAbort = new AbortController();
const bus = new MinioEventBus(logger, consumersAbort);

// Metrics consumers read the raw stream parsed, then resolved to the owning
// friend (parse → look up the friend + attach it); the forwarder reads raw.
const friendEvents = (name: string) =>
  bus.subscribe(name)
    .pipe(parseMinioEvents)
    .pipe(resolveFriend(lookup));

// Each consumer starts on construction and runs for the process's life; it
// catches its own errors (never rejects), and SIGTERM aborts the shared bus
// signal to end every loop. `sampler` is kept for its boot/hourly triggers.
const sampler = new UsageSampler(
  friendEvents("sampler"),
  queries,
  app.mcFactory,
  logger,
);
new MinioEventAggregator(friendEvents("aggregator"), database.db, logger);

// The forwarder is optional — only when the operator configured a target.
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
  // Degraded instances are marked/logged inside the reconciler; anything it
  // can't handle (e.g. the DB read blowing up) is loud but never fatal — the
  // admin UI must come up to show the problem.
  reconcile: () =>
    app.bootReconciler.run().catch((err) =>
      logger.error("boot reconcile failed", { error: String(err) })
    ),
  sweep,
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
    // Two listeners so the exposed surface is minimal: the admin API is
    // loopback-only by construction, and only the token-guarded audit
    // webhook faces the container network.
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
        // Derived from the master key — same value buildApp wires into
        // setAuditWebhook, so instances and listener always agree.
        token: new CryptoKeyGen(env.masterKey).auditWebhookToken(),
        onEvent: (raw) => bus.publish(raw),
      },
      onListen: ({ port }) =>
        logger.info(
          `p0rt1on minio-event webhook listening on ${EVENT_BIND_HOST}:${port}`,
        ),
    });
    // Stop the consumers (ends their loops, cancels in-flight forwards), exit.
    Deno.addSignalListener("SIGTERM", () => {
      consumersAbort.abort();
      Deno.exit(0);
    });
  },
});
