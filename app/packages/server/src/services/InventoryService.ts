import type { ServiceStatus, StatusView } from "@p0rt1on/shared/domain";
import type {
  InstanceDiagnostics,
  InstanceHealth,
  InstanceRuntime,
} from "../runtime/runtime.ts";
import type { InventoryService, Logger } from "./types.ts";

export interface StatusInstanceRow {
  kind: string;
  tsHostname: string;
  minioPort: number;
  status: string;
  tsTag: string;
}

export interface StatusInstances {
  instancesForStatus(): Promise<StatusInstanceRow[]>;
  requestSeriesByInstance(): Promise<Map<string, number[]>>;
}

/** `dataGone` only matters once an instance is otherwise considered down. */
function serviceState(
  health: InstanceHealth,
  dbStatus: string,
  dataGone: boolean,
): ServiceStatus["state"] {
  if (health === "healthy") return "up";
  // Reaping means teardown is already in progress, so a failing health probe
  // is expected there; it surfaces as pending, not down.
  if (dbStatus === "reaping") return "pending";
  if (health === "starting" || dbStatus === "provisioning") {
    return "provisioning";
  }
  // When an instance is down and its data is also gone, the backups are
  // unrecoverable, which is more severe than a down instance whose data survives.
  if (dataGone) return "lost";
  return "down";
}

export class RuntimeInventoryService implements InventoryService {
  constructor(
    private readonly queries: StatusInstances,
    private readonly runtime: InstanceRuntime,
    private readonly logger: Logger,
  ) {}

  async snapshot(): Promise<StatusView> {
    const log = this.logger.child({ op: "status" });
    const [instances, series] = await Promise.all([
      this.queries.instancesForStatus(),
      this.queries.requestSeriesByInstance(),
    ]);
    log.debug("inventory snapshot", { instances: instances.length });
    const probed = await Promise.all(
      instances.map((inst) => this.probe(inst)),
    );
    return {
      minio: probed.map((p) => ({
        ...p.minio,
        spark: series.get(p.minio.instance ?? "") ?? [],
      })),
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
    const workloadName = this.runtime.workloadName(inst.tsHostname);
    const health = await this.runtime.instanceHealth(inst.tsHostname);
    // Only a not-healthy instance can be lost; healthy instances skip the extra storage check.
    const dataGone = health !== "healthy" &&
      !(await this.runtime.hasData(inst.tsHostname));
    const state = serviceState(health, inst.status, dataGone);
    return {
      minio: {
        name: workloadName,
        detail: `${inst.kind} · :${inst.minioPort}`,
        state,
        instance: inst.tsHostname,
      },
      tailscale: {
        // Shares the MinIO row's workload and deliberately omits `instance`,
        // since diagnostics belong on the MinIO row only.
        name: `${inst.tsHostname} (serve)`,
        detail: inst.tsTag,
        state,
      },
    };
  }
}
