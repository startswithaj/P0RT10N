import type { ServiceStatus, StatusView } from "@p0rt1on/shared/domain";
import type {
  ContainerRuntime,
  InstanceDiagnostics,
  InstanceHealth,
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

/** Container health + DB status → the tri-state shown on the Status page. */
function serviceState(
  health: InstanceHealth,
  dbStatus: string,
): ServiceStatus["state"] {
  if (health === "healthy") return "up";
  if (health === "starting" || dbStatus === "provisioning") {
    return "provisioning";
  }
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
    private readonly runtime: ContainerRuntime,
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
    return this.runtime.diagnose(containerNames(instanceName).container);
  }

  private async probe(
    inst: StatusInstanceRow,
  ): Promise<{ minio: ServiceStatus; tailscale: ServiceStatus }> {
    const names = containerNames(inst.tsHostname);
    const health = await this.runtime.health(names.container);
    const state = serviceState(health, inst.status);
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
