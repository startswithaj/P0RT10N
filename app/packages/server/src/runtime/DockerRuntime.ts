import type {
  ContainerHandle,
  ContainerRuntime,
  ContainerState,
  InstanceDiagnostics,
  InstanceHealth,
  InstanceRuntime,
  InstanceSpec,
} from "./runtime.ts";
import { containerNames } from "./names.ts";
import type { CommandRunner } from "../lib/CommandRunner.ts";
import { ServiceError } from "../lib/ServiceError.ts";
import { maskSecrets, safeArgs } from "../lib/redact.ts";

// ============================================================================
// ContainerRuntime over the `docker` (or compatible) CLI. Each instance is ONE
// container (MinIO + tailscaled, see `instance/`). Arg-building + idempotency are
// unit-tested with a fake runner; real container lifecycle is verified by the
// integration suite against a real engine. Every p0rt1on container carries a
// `p0rt1on=1` label so `list()` (the reconcile sweep) and teardown can find them.
// ============================================================================

const LABEL = "p0rt1on=1";

/** docker `State.Status` → our coarse ContainerState. */
function mapState(status: string): ContainerState {
  return status.trim() === "running" ? "running" : "stopped";
}

/** docker `State.Health.Status` → InstanceHealth ("" = no healthcheck yet). */
function mapHealth(status: string): InstanceHealth {
  const s = status.trim();
  if (s === "healthy" || s === "unhealthy" || s === "starting") return s;
  return "unknown";
}

/** Shape of `docker inspect --format '{{json .State}}'` (subset we read). */
interface RawState {
  Status?: string;
  ExitCode?: number;
  Error?: string;
  Health?: { Status?: string; Log?: Array<{ Output?: string }> };
}

/** Parse the `.State` JSON into the fields InstanceDiagnostics needs. */
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
    return empty; // unparseable inspect output — return blanks, not a throw
  }
}

export class DockerRuntime implements ContainerRuntime {
  constructor(
    private readonly runner: CommandRunner,
    private readonly bin = "docker",
  ) {}

  /**
   * Run the instance container: the combined image brings tailscaled up, serves
   * MinIO over the tailnet, and runs MinIO — all inside one container. MinIO is
   * published to the host loopback (`127.0.0.1:<port>`) so the manager reaches it
   * for admin without joining the container's network; friends reach it only over
   * Tailscale. Root creds come from a mounted env-file (path only — no secret in
   * args).
   */
  ensureInstance(spec: InstanceSpec): Promise<ContainerHandle> {
    return this.ensure(spec.name, () => [
      "run",
      "-d",
      "--name",
      spec.name,
      "--label",
      LABEL,
      "--network",
      spec.network,
      // Survive host reboots / docker restarts without the manager's help
      // (boot reconcile covers the cases this can't).
      "--restart",
      "unless-stopped",
      // So MinIO's audit webhook can reach the manager on the host (Linux too).
      "--add-host",
      "host.docker.internal:host-gateway",
      "-p",
      `127.0.0.1:${spec.minioPort}:${spec.minioPort}`,
      "-v",
      `${spec.dataVolume}:/data`,
      "-v",
      `${spec.stateVolume}:/var/lib/tailscale`,
      // The env-file also carries TAILSCALE_AUTHKEY — an enrollment credential
      // must never ride the argv (visible to every process via `ps`).
      "--env-file",
      spec.rootCredSecretRef,
      "-e",
      `TAILSCALE_HOSTNAME=${spec.tsHostname}`,
      "-e",
      `TAILSCALE_TAG=${spec.tag}`,
      "-e",
      `MINIO_PORT=${spec.minioPort}`,
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
    // Adopting always converges the restart policy — pre-existing containers
    // may predate the `--restart unless-stopped` run flag.
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

  /** `docker logs --tail 50` (stdout+stderr); "" on failure. */
  private async logs(name: string): Promise<string> {
    const res = await this.runner.run(this.bin, ["logs", "--tail", "50", name]);
    return res.code === 0 ? res.stdout.trim() : "";
  }

  async stop(name: string): Promise<void> {
    if ((await this.status(name)) === "stopped") return; // no-op if not running
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
    // Best-effort: `volume rm` errors on an absent volume; ignore (already gone).
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

  /** Adopt if present (start if stopped); otherwise run via `makeRunArgs`. */
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

  /**
   * Adopted containers may predate the `--restart unless-stopped` run flag —
   * apply it in place so every adopt converges on the same policy. Idempotent.
   */
  private async retrofitRestartPolicy(name: string): Promise<void> {
    await this.checked(["update", "--restart", "unless-stopped", name]);
  }

  /** `docker inspect` for id + state; absent (not found) → state "absent". */
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

  /**
   * Run a docker subcommand; throw on non-zero exit. Returns stdout.
   * Same redaction rules as McShellClient.exec (lib/redact.ts): declared
   * `secrets` are masked and argv after `--` is never interpolated — no
   * docker failure can put a secret into an error/log.
   */
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

/**
 * Instance-level operations over a DockerRuntime, addressing the instance
 * container by its hostname (so provisioning/offboard don't build names).
 */
export class DockerInstanceRuntime implements InstanceRuntime {
  constructor(private readonly runtime: ContainerRuntime) {}

  ensureInstance(spec: InstanceSpec): Promise<ContainerHandle> {
    return this.runtime.ensureInstance(spec);
  }

  async waitUntilHealthy(instanceName: string): Promise<void> {
    await this.pollHealth(containerNames(instanceName).container, 60);
  }

  async ensureRunning(instanceName: string): Promise<void> {
    await this.runtime.ensureStarted(containerNames(instanceName).container);
  }

  /** Poll health every 2s (recursive, to satisfy no-imperative-loops). */
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

  async stopInstance(instanceName: string): Promise<void> {
    await this.runtime.stop(containerNames(instanceName).container);
  }

  async removeInstance(
    instanceName: string,
    opts: { removeVolumes: boolean },
  ): Promise<void> {
    const names = containerNames(instanceName);
    await this.runtime.remove(names.container, {
      removeVolume: opts.removeVolumes,
    });
    if (opts.removeVolumes) {
      // Legacy 4-volume names included so pre-SNSD instances reap fully;
      // removeVolumes ignores absent names.
      await this.runtime.removeVolumes([
        names.dataVolume,
        ...names.legacyDataVolumes,
        names.stateVolume,
      ]);
    }
  }
}
