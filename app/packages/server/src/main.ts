import { openDatabase } from "./db/Database.ts";
import { runMigrations } from "./db/MigrationRunner.ts";
import { ConsoleLogger } from "./lib/ConsoleLogger.ts";
import { CryptoKeyGen } from "./provisioning/CryptoKeyGen.ts";
import { Env } from "./lib/Env.ts";
import { AuditAggregator } from "./audit/AuditAggregator.ts";
import { buildApp } from "./app.ts";
import { runBoot } from "./boot/boot.ts";
import { startServer } from "./server.ts";

// Server entrypoint: read env → open DB → wire services → run the boot
// sequence (migrations → stale-provisioning flip → container reconcile →
// sweep → serve; ordering lives in boot.ts where it's tested). Thin by
// design — the Deno.serve glue isn't unit-tested; app.ts wiring and the HTTP
// path have their own tests.

const env = new Env();
const logger = new ConsoleLogger({ level: env.logLevel });
logger.info("p0rt1on starting", { level: env.logLevel, pid: Deno.pid });

logger.debug("opening database", { dbPath: env.dbPath });
const database = openDatabase(env.dbPath);

const app = buildApp(database, env, logger); // throws if master key unset
const context = app.context;
const aggregator = new AuditAggregator(database.db, logger);

const sweep = () =>
  context.provisioningService.sweepFailed().catch((err) =>
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
    startServer({
      port: env.port,
      hostname: env.bindHost,
      context,
      staticDir: env.staticDir,
      audit: {
        // Derived from the master key — same value buildApp wires into
        // setAuditWebhook, so instances and listener always agree.
        token: new CryptoKeyGen(env.requireMasterKey()).auditWebhookToken(),
        onEvent: (raw) => aggregator.ingestRaw(raw),
      },
      onListen: ({ port }) =>
        logger.info(`p0rt1on listening on ${env.bindHost}:${port}`),
    });
  },
});
