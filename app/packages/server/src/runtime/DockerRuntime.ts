import type {
  ContainerHandle,
  ContainerRunSpec,
  ContainerRuntime,
  ContainerState,
  DockerResources,
  InstanceDiagnostics,
  InstanceHealth,
  InstanceRuntime,
  InstanceSpec,
  InstanceTailscaleOptions,
} from "./runtime.ts";
import { tailscaleEnv } from "./runtime.ts";
import { containerNames } from "./names.ts";
import type { Pantry } from "./pantry.ts";
import {
  adminEndpointComposer,
  type InstanceAddressing,
} from "./adminEndpoint.ts";
import type { CommandRunner, TempFiles } from "../lib/CommandRunner.ts";
import { ServiceError } from "../lib/ServiceError.ts";
import { maskSecrets, safeArgs } from "../lib/redact.ts";

const LABEL = "p0rt1on=1";

/** The docker network the manager and every instance join. It is created
 * out-of-band (`docker network create p0rt1on-net`). */
export const DOCKER_NETWORK = "p0rt1on-net";

function resourceArgs(r: ContainerRunSpec["resources"]): string[] {
  return [
    ...(r?.cpuShares ? ["--cpu-shares", r.cpuShares] : []),
    ...(r?.cpus ? ["--cpus", r.cpus] : []),
    ...(r?.memoryReservation
      ? ["--memory-reservation", r.memoryReservation]
      : []),
    ...(r?.memoryLimit ? ["--memory", r.memoryLimit] : []),
  ];
}

function mapState(status: string): ContainerState {
  return status.trim() === "running" ? "running" : "stopped";
}

/** "" (no healthcheck result yet) maps to "unknown". */
function mapHealth(status: string): InstanceHealth {
  const s = status.trim();
  if (s === "healthy" || s === "unhealthy" || s === "starting") return s;
  return "unknown";
}

/** The subset of `docker inspect --format '{{json .State}}'` output we read. */
interface RawState {
  Status?: string;
  ExitCode?: number;
  Error?: string;
  Health?: { Status?: string; Log?: Array<{ Output?: string }> };
}

function parseState(json: string): {
  status: string;
  exitCode: number | null;
  error: string | null;
  healthStatus: string;
  healthReason: string | null;
} {
  const empty = {
    status: "",
    exitCode: null,
    error: null,
    healthStatus: "",
    healthReason: null,
  };
  try {
    const s = JSON.parse(json) as RawState;
    const log = s.Health?.Log ?? [];
    const last = log.length > 0
      ? (log[log.length - 1].Output ?? "").trim()
      : "";
    return {
      status: s.Status ?? "",
      exitCode: typeof s.ExitCode === "number" ? s.ExitCode : null,
      error: s.Error ? s.Error : null,
      healthStatus: s.Health?.Status ?? "",
      healthReason: last.length > 0 ? last : null,
    };
  } catch (_err) {
    return empty; // unparseable inspect output: return blanks rather than throwing
  }
}

export class DockerRuntime implements ContainerRuntime {
  constructor(
    private readonly runner: CommandRunner,
    private readonly bin = "docker",
  ) {}

  /** One container runs tailscaled + `tailscale serve` + MinIO; friends reach
   * it only over Tailscale. */
  ensureInstance(spec: ContainerRunSpec): Promise<ContainerHandle> {
    return this.ensure(spec.name, () => [
      "run",
      "-d",
      "--name",
      spec.name,
      "--label",
      LABEL,
      "--network",
      spec.network,
      // Survives host reboots and docker restarts without the manager's help;
      // boot reconcile covers the cases this can't.
      "--restart",
      "unless-stopped",
      // Lets MinIO's audit webhook reach a host-run manager; host-gateway makes
      // host.docker.internal resolve on Linux too.
      "--add-host",
      "host.docker.internal:host-gateway",
      ...(spec.publishHostPort
        ? ["-p", `127.0.0.1:${spec.minioPort}:${spec.minioPort}`]
        : []),
      "-v",
      `${spec.dataSource}:/data`,
      "-v",
      `${spec.stateSource}:/var/lib/tailscale`,
      // The env-file also carries TAILSCALE_AUTHKEY: an enrollment credential
      // must never ride the argv, which is visible to every process via `ps`.
      "--env-file",
      spec.rootCredSecretRef,
      "-e",
      `TAILSCALE_HOSTNAME=${spec.tsHostname}`,
      "-e",
      `MINIO_PORT=${spec.minioPort}`,
      ...resourceArgs(spec.resources),
      spec.image,
    ]);
  }

  async status(name: string): Promise<ContainerState> {
    return (await this.inspect(name)).state;
  }

  async ensureStarted(name: string): Promise<void> {
    const found = await this.inspect(name);
    if (found.state === "absent") {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `container ${name} not found — cannot adopt a container that does not exist`,
      );
    }
    await this.retrofitRestartPolicy(name);
    if (found.state === "stopped") await this.checked(["start", name]);
  }

  async health(name: string): Promise<InstanceHealth> {
    const res = await this.runner.run(this.bin, [
      "inspect",
      "-f",
      "{{.State.Health.Status}}",
      name,
    ]);
    if (res.code !== 0) return "unknown";
    return mapHealth(res.stdout);
  }

  async diagnose(name: string): Promise<InstanceDiagnostics> {
    const res = await this.runner.run(this.bin, [
      "inspect",
      "--format",
      "{{json .State}}",
      name,
    ]);
    if (res.code !== 0) {
      return {
        name,
        state: "absent",
        health: "unknown",
        healthReason: null,
        exitCode: null,
        exitError: null,
        recentLogs: "",
      };
    }
    const st = parseState(res.stdout);
    return {
      name,
      state: mapState(st.status),
      health: mapHealth(st.healthStatus),
      healthReason: st.healthReason,
      exitCode: st.exitCode,
      exitError: st.error,
      recentLogs: await this.logs(name),
    };
  }

  /** Returns "" on failure — logs are best-effort. */
  private async logs(name: string): Promise<string> {
    const res = await this.runner.run(this.bin, ["logs", "--tail", "50", name]);
    return res.code === 0 ? res.stdout.trim() : "";
  }

  async stop(name: string): Promise<void> {
    if ((await this.status(name)) === "stopped") return;
    await this.checked(["stop", name]);
  }

  async remove(name: string, opts: { removeVolume: boolean }): Promise<void> {
    const args = opts.removeVolume
      ? ["rm", "-f", "-v", name]
      : ["rm", "-f", name];
    await this.checked(args);
  }

  async removeVolumes(names: string[]): Promise<void> {
    if (names.length === 0) return;
    // Best-effort: `volume rm` errors on an absent volume, but already gone is
    // success, so the result is ignored.
    await this.runner.run(this.bin, ["volume", "rm", "-f", ...names]);
  }

  async list(): Promise<ContainerHandle[]> {
    const out = await this.checked([
      "ps",
      "-a",
      "--filter",
      `label=${LABEL}`,
      "--format",
      "{{.Names}}|{{.ID}}|{{.State}}",
    ]);
    return out.trim().split("\n").filter((l) => l.length > 0).map((line) => {
      const [name, id, state] = line.split("|");
      return { name, id, state: mapState(state) };
    });
  }

  // ---- helpers ----

  private async ensure(
    name: string,
    makeRunArgs: () => string[],
  ): Promise<ContainerHandle> {
    const found = await this.inspect(name);
    if (found.state === "running") {
      await this.retrofitRestartPolicy(name);
      return { name, id: found.id, state: "running" };
    }
    if (found.state === "stopped") {
      await this.retrofitRestartPolicy(name);
      await this.checked(["start", name]);
      return { name, id: found.id, state: "running" };
    }
    const id = (await this.checked(makeRunArgs())).trim();
    return { name, id, state: "running" };
  }

  /** Adopted containers may predate the `--restart unless-stopped` run flag,
   * so apply it in place on every adopt. Idempotent. */
  private async retrofitRestartPolicy(name: string): Promise<void> {
    await this.checked(["update", "--restart", "unless-stopped", name]);
  }

  private async inspect(
    name: string,
  ): Promise<{ state: ContainerState | "absent"; id: string }> {
    const res = await this.runner.run(this.bin, [
      "inspect",
      "-f",
      "{{.Id}} {{.State.Status}}",
      name,
    ]);
    if (res.code !== 0) return { state: "absent", id: "" };
    const [id, status] = res.stdout.trim().split(" ");
    return { state: mapState(status ?? ""), id: id ?? "" };
  }

  /** Declared `secrets` are masked, and argv after `--` is never interpolated
   * (lib/redact.ts), so no docker failure can leak a secret. */
  private async checked(
    args: string[],
    secrets: string[] = [],
  ): Promise<string> {
    const res = await this.runner.run(this.bin, args);
    if (res.code !== 0) {
      const raw = `${this.bin} ${safeArgs(args)} failed (${res.code}): ${
        res.stderr.trim() || res.stdout.trim()
      }`;
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        maskSecrets(raw, secrets),
      );
    }
    return res.stdout;
  }
}

/** MinIO data lives in the pantry; tailscale state stays in a named volume so
 * the pantry holds backup data only. */
export class DockerInstanceRuntime implements InstanceRuntime {
  constructor(
    private readonly runtime: ContainerRuntime,
    private readonly tempFiles: TempFiles,
    private readonly config: {
      network: string;
      addressing: InstanceAddressing;
      pantry: Pantry;
      tailscale?: InstanceTailscaleOptions;
      resources?: DockerResources;
    },
  ) {}

  adminEndpoint(instanceName: string, minioPort: number): string {
    return adminEndpointComposer(this.config.addressing)({
      alias: instanceName,
      minioPort,
    });
  }

  async ensureInstance(spec: InstanceSpec): Promise<ContainerHandle> {
    const names = containerNames(spec.name);
    await this.config.pantry.ensure(spec.name);
    // Secrets ride a short-lived env-file (removed in the finally) rather than
    // the ps-visible argv; non-secret tailscale extras ride the same file.
    const extraEnv = Object.entries(tailscaleEnv(this.config.tailscale))
      .map(([k, v]) => `${k}=${v}\n`).join("");
    const envFile = await this.tempFiles.write(
      `MINIO_ROOT_USER=${spec.rootCred.accessKeyId}\n` +
        `MINIO_ROOT_PASSWORD=${spec.rootCred.secretKey}\n` +
        `TAILSCALE_AUTHKEY=${spec.tsAuthKey}\n` +
        extraEnv,
    );
    try {
      return await this.runtime.ensureInstance({
        name: names.container,
        image: spec.image,
        tsHostname: spec.name,
        tag: spec.tag,
        minioPort: spec.minioPort,
        dataSource: this.config.pantry.dataDir(spec.name),
        stateSource: names.stateVolume,
        rootCredSecretRef: envFile,
        network: this.config.network,
        publishHostPort: this.config.addressing === "host",
        resources: this.config.resources,
      });
    } finally {
      await this.tempFiles.remove(envFile);
    }
  }

  async waitUntilHealthy(instanceName: string): Promise<void> {
    await this.pollHealth(containerNames(instanceName).container, 60);
  }

  async ensureRunning(instanceName: string): Promise<void> {
    await this.runtime.ensureStarted(containerNames(instanceName).container);
  }

  /** Polls health every 2s; recursive to satisfy the no-imperative-loops rule. */
  private async pollHealth(name: string, attemptsLeft: number): Promise<void> {
    const health = await this.runtime.health(name);
    if (health === "healthy") return;
    if (attemptsLeft <= 0) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `instance ${name} did not become healthy (last status: ${health})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return this.pollHealth(name, attemptsLeft - 1);
  }

  diagnoseInstance(instanceName: string): Promise<InstanceDiagnostics> {
    return this.runtime.diagnose(containerNames(instanceName).container);
  }

  instanceHealth(instanceName: string): Promise<InstanceHealth> {
    return this.runtime.health(containerNames(instanceName).container);
  }

  hasData(instanceName: string): Promise<boolean> {
    return this.config.pantry.exists(instanceName);
  }

  async listInstances(): Promise<
    { name: string; state: ContainerState }[]
  > {
    // Labelled containers are always named by containerNames(); strip the
    // prefix back to the instance (tailnet-hostname) name.
    const prefix = containerNames("").container;
    return (await this.runtime.list()).map((c) => ({
      name: c.name.startsWith(prefix) ? c.name.slice(prefix.length) : c.name,
      state: c.state,
    }));
  }

  async stopInstance(instanceName: string): Promise<void> {
    await this.runtime.stop(containerNames(instanceName).container);
  }

  async removeInstance(
    instanceName: string,
    opts: { removeData: boolean },
  ): Promise<void> {
    const names = containerNames(instanceName);
    await this.runtime.remove(names.container, {
      removeVolume: opts.removeData,
    });
    if (!opts.removeData) return;
    // Current and legacy named DATA volumes are reaped too, so a pre-pantry
    // instance still tears down fully; removeVolumes ignores absent names.
    await this.runtime.removeVolumes([
      names.stateVolume,
      names.dataVolume,
      ...names.legacyDataVolumes,
    ]);
    await this.config.pantry.remove(instanceName);
  }
}
