import type { ContainerState, InstanceRuntime } from "../runtime/runtime.ts";
import type { ProvisioningRepo } from "../provisioning/deps.ts";
import type { Logger } from "../services/types.ts";

// ============================================================================
// Boot-time container reconcile: the DB records which instances SHOULD exist;
// the runtime is reality; this compares them once per boot (after the stale-
// provisioning flip, before the listeners) so "restart the box" is a
// non-event. It never DELETES containers, volumes, or data. It DOES recreate a
// missing instance over its surviving data (delegated to the provisioning
// layer) — an instance whose data is ALSO gone is marked failed, never
// fabricated empty.
// ============================================================================

/** What happened to one instance during the reconcile. */
type Outcome =
  | "healthy"
  | "started"
  | "recovered"
  | "failed"
  | "unhealthy"
  | "error";

export interface ReconcileSummary {
  /** Stopped containers brought back up (and verified healthy). */
  started: number;
  /** Already running and healthy. */
  healthy: number;
  /** Container gone but data survived → recreated over it. */
  recovered: number;
  /** Container AND data both gone → instance + friends marked failed. */
  failed: number;
  /** Labelled containers with no DB row — logged, left alone. */
  orphaned: number;
  /** Alive but not healthy after the bounded wait, or reconcile errored. */
  degraded: number;
}

/**
 * The provisioning-layer ops the reconcile delegates to (ProvisioningService
 * satisfies this). `realignInstance` re-issues the webhook + ACLs for a present
 * instance; `recoverInstance` recreates a missing one over its surviving data.
 */
export interface InstanceReconcileOps {
  realignInstance(instance: InstanceRow): Promise<void>;
  recoverInstance(instance: InstanceRow): Promise<void>;
}

/** Bounded health wait — injectable so tests don't sleep. */
export interface HealthWait {
  attempts: number;
  delayMs: number;
}

type InstanceRow = {
  instanceId: number;
  tsHostname: string;
  minioPort: number;
  status: string;
};

export class BootReconciler {
  constructor(
    private readonly repo: ProvisioningRepo,
    private readonly runtime: InstanceRuntime,
    private readonly ops: InstanceReconcileOps,
    private readonly logger: Logger,
    // Containers may still be starting right after a host boot (tailscaled +
    // MinIO both need to come up) — cap the wait so boot never stalls;
    // instances still starting are picked up by the normal status paths.
    private readonly wait: HealthWait = { attempts: 30, delayMs: 2000 },
  ) {}

  async run(): Promise<ReconcileSummary> {
    const log = this.logger.child({ op: "bootReconcile" });
    const rows = await this.repo.liveInstances();
    const instances = await this.runtime.listInstances().then(
      (list) => list,
      (err) => {
        // The admin UI must still come up to SHOW the problem — never fatal.
        log.error("runtime unreachable — skipping instance reconcile", {
          error: String(err),
        });
        return null;
      },
    );
    if (instances === null) {
      return {
        started: 0,
        healthy: 0,
        recovered: 0,
        failed: 0,
        orphaned: 0,
        degraded: 0,
      };
    }

    const byName = new Map(instances.map((c) => [c.name, c]));
    const outcomes = await Promise.all(
      rows.map((row) =>
        this.reconcileOne(row, byName.get(row.tsHostname), log)
          .catch((err): Outcome => {
            // One bad instance never aborts the others or the boot.
            log.error("reconcile failed for instance", {
              instance: row.tsHostname,
              error: String(err),
            });
            return "error";
          })
      ),
    );

    const known = new Set(rows.map((row) => row.tsHostname));
    const orphans = instances.filter((c) => !known.has(c.name));
    orphans.forEach((o) =>
      log.warn("orphan p0rt1on instance with no DB row — left untouched", {
        instance: o.name,
      })
    );

    const count = (o: Outcome) => outcomes.filter((x) => x === o).length;
    const summary: ReconcileSummary = {
      started: count("started"),
      healthy: count("healthy"),
      recovered: count("recovered"),
      failed: count("failed"),
      orphaned: orphans.length,
      degraded: count("unhealthy") + count("error"),
    };
    log.info("boot reconcile complete", { ...summary });
    return summary;
  }

  private async reconcileOne(
    row: InstanceRow,
    instance: { name: string; state: ContainerState } | undefined,
    log: Logger,
  ): Promise<Outcome> {
    if (!instance) {
      // Container gone. If the DATA survived (pantry dir / data PVC), recreate
      // the instance over it — same identity, no friend action. If the data is
      // ALSO gone, do NOT fabricate an empty instance over destroyed backups:
      // mark failed so it's surfaced.
      if (await this.runtime.hasData(row.tsHostname)) {
        log.warn("instance container gone but data survives — recreating", {
          instance: row.tsHostname,
        });
        await this.ops.recoverInstance(row);
        return "recovered";
      }
      const friendsFailed = await this.repo.failInstanceMissing(row.instanceId);
      log.error("instance AND its data are gone — marked failed", {
        instance: row.tsHostname,
        friendsFailed,
      });
      return "failed";
    }
    // Adopt regardless of state: starts it if stopped, and converges config
    // drift (e.g. the restart policy) even when it's already running.
    await this.runtime.ensureRunning(row.tsHostname);
    const healthy = await this.waitHealthy(row.tsHostname, this.wait.attempts);
    if (!healthy) {
      // Alive but not healthy: log only. Marking it failed would feed the
      // sweep, which DELETES instances and their data — boot never destroys.
      // The status page surfaces it as down.
      log.error("instance not healthy after bounded wait — left as-is", {
        instance: row.tsHostname,
      });
      return "unhealthy";
    }
    // Re-issue the webhook (derived token) + re-apply ACLs — converges the
    // config that lives outside the instance's data. Idempotent.
    await this.ops.realignInstance(row);
    return instance.state === "stopped" ? "started" : "healthy";
  }

  /** Recursive bounded poll of the instance's health probe. */
  private async waitHealthy(
    name: string,
    attemptsLeft: number,
  ): Promise<boolean> {
    const health = await this.runtime.instanceHealth(name);
    if (health === "healthy") return true;
    if (attemptsLeft <= 1) return false;
    await new Promise((resolve) => setTimeout(resolve, this.wait.delayMs));
    return this.waitHealthy(name, attemptsLeft - 1);
  }
}
