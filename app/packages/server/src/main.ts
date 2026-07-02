import { openDatabase } from "./db/Database.ts";
import { runMigrations } from "./db/MigrationRunner.ts";
import { ConsoleLogger } from "./lib/ConsoleLogger.ts";
import { Env } from "./lib/Env.ts";
import { AuditAggregator } from "./audit/AuditAggregator.ts";
import { buildContext } from "./app.ts";
import { startServer } from "./server.ts";

// Server entrypoint: read env → open DB → apply migrations → wire services →
// serve tRPC. Thin by design (the Deno.serve glue isn't unit-tested; the wiring
// in app.ts and the HTTP path in server.ts are covered by their own tests).

const env = new Env();
const logger = new ConsoleLogger({ level: env.logLevel });
logger.info("p0rt1on starting", { level: env.logLevel, pid: Deno.pid });

logger.debug("opening database", { dbPath: env.dbPath });
const database = openDatabase(env.dbPath);
runMigrations(database.driver, logger);

const context = buildContext(database, env, logger); // throws if master key unset
const aggregator = new AuditAggregator(database.db, logger);

// Cleanup sweep: reap failed-provision tombstones on boot, then every 10 min.
const sweep = () =>
  context.provisioningService.sweepFailed().catch((err) =>
    logger.error("cleanup sweep failed", { error: String(err) })
  );
sweep();
setInterval(sweep, 10 * 60 * 1000);

startServer({
  port: env.port,
  hostname: env.bindHost,
  context,
  staticDir: env.staticDir,
  audit: {
    token: env.auditWebhookToken,
    onEvent: (raw) => aggregator.ingestRaw(raw),
  },
  onListen: ({ port }) =>
    logger.info(`p0rt1on listening on ${env.bindHost}:${port}`),
});
