import type { ContainerState, InstanceRuntime } from "../runtime/runtime.ts";
import type { ProvisioningRepo } from "../provisioning/deps.ts";
import type { Logger } from "../services/types.ts";

// Boot reconcile never deletes containers, volumes, or data.

type Outcome =
  | "healthy"
  | "started"
  | "recovered"
  | "failed"
  | "unhealthy"
  | "error";

export interface ReconcileSummary {
  started: number;
  healthy: number;
  recovered: number;
  failed: number;
  orphaned: number;
  degraded: number;
}

export interface InstanceReconcileOps {
  realignInstance(instance: InstanceRow): Promise<void>;
  recoverInstance(instance: InstanceRow): Promise<void>;
}

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
    // Right after a host boot, tailscaled and MinIO may still be starting, so the wait is
    // bounded and boot never stalls; still-starting instances are picked up by the normal status paths.
    private readonly wait: HealthWait = { attempts: 30, delayMs: 2000 },
  ) {}

  async run(): Promise<ReconcileSummary> {
    const log = this.logger.child({ op: "bootReconcile" });
    const rows = await this.repo.liveInstances();
    const instances = await this.runtime.listInstances().then(
      (list) => list,
      (err) => {
        // The admin UI must still come up to show the problem, so a runtime failure here is never fatal.
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
      // If the container is gone but its data survived, the instance is recreated over that data
      // with the same identity and no friend action. If the data is also gone, boot does not
      // fabricate an empty instance over destroyed backups; it marks the instance failed instead.
      if (await this.runtime.hasData(row.tsHostname)) {
        log.warn("instance container gone but data survives — recreating", {
          instance: row.tsHostname,
        });
        await this.ops.recoverInstance(row);
        return "recovered";
      }
      const friendsFailed = await this.repo.failInstanceMissing(row.instanceId);
      // The loss is audited as a system row so it survives even after the failed friend
      // rows are later swept, giving a permanent record of when the data was lost.
      await this.repo.audit(
        null,
        "instance_data_lost",
        `${row.tsHostname} — ${friendsFailed} portion(s), backups unrecoverable`,
      );
      log.error("instance AND its data are gone — marked failed", {
        instance: row.tsHostname,
        friendsFailed,
      });
      return "failed";
    }
    // A missing credentials Secret cannot fix itself: the pod can never start
    // without it, so the bounded health wait below would burn its full budget
    // and then leave the instance broken. Safe to rebuild — the root cred is
    // derived from the master key and the serve key is re-minted, and
    // ensureInstance re-applies the Secret over the surviving data.
    if (!(await this.runtime.hasCredentials(row.tsHostname))) {
      log.warn("instance credentials are gone — recreating", {
        instance: row.tsHostname,
      });
      await this.ops.recoverInstance(row);
      return "recovered";
    }
    // The instance is adopted regardless of its current state, meaning it is started if stopped
    // and any config drift, such as the restart policy, is converged even when already running.
    await this.runtime.ensureRunning(row.tsHostname);
    const healthy = await this.waitHealthy(row.tsHostname, this.wait.attempts);
    if (!healthy) {
      // If alive but unhealthy, this only logs rather than marking the instance failed, because a
      // failed status feeds the sweep that deletes instances and their data, and boot must never destroy anything.
      log.error("instance not healthy after bounded wait — left as-is", {
        instance: row.tsHostname,
      });
      return "unhealthy";
    }
    // Re-issuing the webhook and reapplying ACLs converges config that lives outside the
    // instance's data, and this call is idempotent.
    await this.ops.realignInstance(row);
    return instance.state === "stopped" ? "started" : "healthy";
  }

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
