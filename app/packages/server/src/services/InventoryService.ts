import type { ServiceStatus, StatusView } from "@p0rt1on/shared/domain";
import type {
  InstanceDiagnostics,
  InstanceHealth,
  InstanceRuntime,
} from "../runtime/runtime.ts";
import { containerNames } from "../runtime/names.ts";
import type { InventoryService, Logger } from "./types.ts";

/** One instance row the inventory probes (subset of the instances table). */
export interface StatusInstanceRow {
  kind: string;
  tsHostname: string;
  minioPort: number;
  status: string;
  tsTag: string;
}

/** The read-side dependency: just the instance list. */
export interface StatusInstances {
  instancesForStatus(): Promise<StatusInstanceRow[]>;
}

/** Container health + DB status (+ whether the data survives) → the Status-page
 * state. `dataGone` only matters once an instance is otherwise "down". */
function serviceState(
  health: InstanceHealth,
  dbStatus: string,
  dataGone: boolean,
): ServiceStatus["state"] {
  if (health === "healthy") return "up";
  // Reaping is teardown-in-progress: the container is going away on purpose, so
  // a failing health probe here is expected — surface it as pending, not down.
  if (dbStatus === "reaping") return "pending";
  if (health === "starting" || dbStatus === "provisioning") {
    return "provisioning";
  }
  // Down AND the data is gone ⇒ the backups are unrecoverable — a distinct,
  // louder state than a down instance whose pantry data survives (recoverable).
  if (dataGone) return "lost";
  return "down";
}

/**
 * Builds the Status-page inventory: each instance is one container (MinIO +
 * tailscaled) probed for health via the runtime; both the MinIO row and the
 * Tailscale row reflect that single container. Plus the control-plane API. The
 * probes run concurrently per instance.
 */
export class RuntimeInventoryService implements InventoryService {
  constructor(
    private readonly queries: StatusInstances,
    private readonly runtime: InstanceRuntime,
    private readonly tailnetDomain: string,
    private readonly logger: Logger,
  ) {}

  async snapshot(): Promise<StatusView> {
    const log = this.logger.child({ op: "status" });
    const instances = await this.queries.instancesForStatus();
    log.debug("inventory snapshot", { instances: instances.length });
    const probed = await Promise.all(
      instances.map((inst) => this.probe(inst)),
    );
    return {
      minio: probed.map((p) => p.minio),
      tailscale: probed.map((p) => p.tailscale),
      host: [{ name: "p0rt1on-api", detail: "control-plane API", state: "up" }],
    };
  }

  diagnose(instanceName: string): Promise<InstanceDiagnostics> {
    this.logger.debug("diagnosing instance", { instanceName });
    return this.runtime.diagnoseInstance(instanceName);
  }

  private async probe(
    inst: StatusInstanceRow,
  ): Promise<{ minio: ServiceStatus; tailscale: ServiceStatus }> {
    // The container name stays as the row LABEL only (the status page shows
    // the real resource name for debugging); health goes through the
    // runtime-agnostic interface.
    const names = containerNames(inst.tsHostname);
    const health = await this.runtime.instanceHealth(inst.tsHostname);
    // Only a not-healthy instance can be "lost"; healthy ones skip the extra
    // storage check. Data gone (pantry dir / data PVC) while down = backups lost.
    const dataGone = health !== "healthy" &&
      !(await this.runtime.hasData(inst.tsHostname));
    const state = serviceState(health, inst.status, dataGone);
    return {
      minio: {
        name: names.container,
        detail: `${inst.kind} · :${inst.minioPort}`,
        state,
        instance: inst.tsHostname,
      },
      tailscale: {
        // Same container as the MinIO row; diagnostics live on that row only
        // (no `instance` → not expandable). Show the tag + the serve URL.
        name: `${inst.tsHostname} (serve)`,
        detail:
          `${inst.tsTag} · https://${inst.tsHostname}.${this.tailnetDomain}`,
        state,
      },
    };
  }
}
