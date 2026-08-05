import { assertDbDirWritable, openDatabase } from "./db/Database.ts";
import { runMigrations } from "./db/MigrationRunner.ts";
import { ConsoleLogger } from "./lib/ConsoleLogger.ts";
import { Env, EVENT_BIND_HOST, EVENT_PORT } from "./lib/Env.ts";
import { buildApp } from "./app.ts";
import { runBoot } from "./boot/boot.ts";
import { reportPreflight } from "./boot/reportPreflight.ts";
import { startMinioEventServer, startServer } from "./server.ts";

// Entry point: lifecycle only — read env, open the database, then boot, time,
// serve and shut down. Every dependency is constructed in buildApp (app.ts),
// which is the single composition root; nothing is wired here.
// The boot ordering (migrate, flip stale provisioning, reconcile, sweep, serve)
// lives in boot.ts.

const env = new Env(); // Validates required vars; refuses to boot when any are missing.
const distDir = `${import.meta.dirname}/../dist`;
const staticDir = await Deno.stat(distDir)
  .then((s) => s.isDirectory ? distDir : undefined)
  .catch(() => undefined);
const logger = new ConsoleLogger({ level: env.logLevel });
logger.info("p0rt1on starting", { level: env.logLevel, pid: Deno.pid });

// Fatal, not a health check: an unwritable DB means the manager cannot
// function at all, so this fails loudly here rather than showing an admin
// UI that can never do anything (unlike preflight below, which is best-effort).
await assertDbDirWritable(env.dbPath).catch((err) => {
  logger.error("database directory is not usable", { error: String(err) });
  throw err;
});

logger.debug("opening database", { dbPath: env.dbPath });
const database = openDatabase(env.dbPath);

const app = await buildApp(database, env, logger);
const context = app.context;

const sweep = () =>
  context.provisioningService.sweepFailed()
    // Same cadence: cap the append-only usage-sample history.
    .then(() => app.queries.pruneUsage())
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
  // Probes deployment prerequisites so the UI can gate portion creation.
  // Failures are logged but never fatal, because the admin UI must come up to surface the problem.
  preflight: () =>
    context.systemHealthService.probe()
      .then((h) => reportPreflight(h, logger))
      .catch((err) =>
        logger.error("preflight probe failed", { error: String(err) })
      ),
  serve: () => {
    // Reap tombstones every 10 min after the boot-time pass.
    setInterval(sweep, 10 * 60 * 1000);

    // Usage samples: once now (dashboard never empty after a restart) and
    // hourly as the idle baseline; the audit debounce covers active friends.
    const sampleAll = () =>
      app.sampler.sampleAll().catch((err) =>
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
        // The same value buildApp wires into setAuditWebhook, so instances and
        // the listener always agree on it.
        token: app.auditWebhookToken,
        onEvent: (raw) => app.bus.publish(raw),
      },
      onListen: ({ port }) =>
        logger.info(
          `p0rt1on minio-event webhook listening on ${EVENT_BIND_HOST}:${port}`,
        ),
    });
    Deno.addSignalListener("SIGTERM", () => {
      app.consumersAbort.abort();
      Deno.exit(0);
    });
  },
});
