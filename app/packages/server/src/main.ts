import { openDatabase } from "./db/Database.ts";
import { runMigrations } from "./db/MigrationRunner.ts";
import { ConsoleLogger } from "./lib/ConsoleLogger.ts";
import { CryptoKeyGen } from "./provisioning/CryptoKeyGen.ts";
import { Env } from "./lib/Env.ts";
import { AuditAggregator } from "./audit/AuditAggregator.ts";
import { FriendQueries } from "./db/FriendQueries.ts";
import { buildApp } from "./app.ts";
import { runBoot } from "./boot/boot.ts";
import { startAuditServer, startServer } from "./server.ts";
import { UsageSampler } from "./audit/UsageSampler.ts";

// Server entrypoint: read env → open DB → wire services → run the boot
// sequence (migrations → stale-provisioning flip → container reconcile →
// sweep → serve; ordering lives in boot.ts where it's tested). Thin by
// design — the Deno.serve glue isn't unit-tested; app.ts wiring and the HTTP
// path have their own tests.

const env = new Env(); // validates required vars — refuses to boot without them
const logger = new ConsoleLogger({ level: env.logLevel });
logger.info("p0rt1on starting", { level: env.logLevel, pid: Deno.pid });

logger.debug("opening database", { dbPath: env.dbPath });
const database = openDatabase(env.dbPath);

const app = await buildApp(database, env, logger);
const context = app.context;

const queries = new FriendQueries(database.db);
// Usage samples (`mc du` per friend): at boot, hourly, and 30s after the
// last audit event of a burst — so a finished backup shows on the dashboard
// in ~30s without measuring mid-upload.
const sampler = new UsageSampler(queries, app.mcFactory, logger);
const aggregator = new AuditAggregator(
  database.db,
  logger,
  undefined,
  (friendId) => sampler.noteActivity(friendId),
);

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
      staticDir: env.staticDir,
      onListen: ({ port }) =>
        logger.info(`p0rt1on admin listening on ${env.adminBindHost}:${port}`),
    });
    startAuditServer({
      port: env.auditPort,
      hostname: env.auditBindHost,
      audit: {
        // Derived from the master key — same value buildApp wires into
        // setAuditWebhook, so instances and listener always agree.
        token: new CryptoKeyGen(env.masterKey).auditWebhookToken(),
        onEvent: (raw) => aggregator.ingestRaw(raw),
      },
      onListen: ({ port }) =>
        logger.info(
          `p0rt1on audit webhook listening on ${env.auditBindHost}:${port}`,
        ),
    });
  },
});
