import type { S3Credential } from "../minio/mc.ts";

// All "ensure" methods are IDEMPOTENT: re-running adopts the existing instance instead of creating a second one.

export type ContainerState = "running" | "stopped" | "absent";

export type InstanceHealth = "healthy" | "unhealthy" | "starting" | "unknown";

export interface ContainerHandle {
  name: string;
  id: string;
  state: ContainerState;
}

export interface InstanceDiagnostics {
  name: string;
  state: ContainerState;
  health: InstanceHealth;
  healthReason: string | null;
  exitCode: number | null;
  exitError: string | null;
  recentLogs: string;
  /** The image the workload is actually running, when known. Kubernetes-only. */
  image?: string | null;
  /** Recent pod-level events (scheduling failures, unbound PVCs, image
   * pulls), most recent first. Kubernetes-only — the one signal that
   * survives when a pod never gets a container status at all (e.g. an
   * unbound PVC), which container diagnostics alone would miss entirely. */
  events?: string[];
}

/** Secrets (`rootCred`, `tsAuthKey`) exist in memory only and must never
 * reach argv, logs, or the DB. */
export interface InstanceSpec {
  /** The instance name is also its tailnet hostname. */
  name: string;
  image: string;
  /** Server-side serve-node tag for the instance's own tailscaled. */
  tag: string;
  /** The port MinIO listens on for the admin plane. */
  minioPort: number;
  /** The MinIO root credential is deterministically derived, never stored. */
  rootCred: S3Credential;
  /** Single-use tailnet enrollment key for the instance's serve node. */
  tsAuthKey: string;
}

export interface InstanceTailscaleOptions {
  loginServer?: string;
  serveMode: "https" | "http";
}

/** Returns an empty record when everything is on defaults, so SaaS deployments
 * produce a container env byte-identical to before these options existed. */
export function tailscaleEnv(
  opts: InstanceTailscaleOptions | undefined,
): Record<string, string> {
  if (opts === undefined) return {};
  return {
    ...(opts.loginServer ? { TAILSCALE_LOGIN_SERVER: opts.loginServer } : {}),
    ...(opts.serveMode === "http" ? { TAILSCALE_SERVE_MODE: "http" } : {}),
  };
}

/** Per-portion docker resource caps, as native `docker run` values. */
export interface DockerResources {
  cpuShares?: string;
  cpus?: string;
  memoryReservation?: string;
  memoryLimit?: string;
}

/** `rootCredSecretRef` names an env-file carrying the root creds and
 * TAILSCALE_AUTHKEY, so only a path — never a secret — appears on argv. */
export interface ContainerRunSpec {
  name: string;
  image: string;
  tsHostname: string;
  tag: string;
  minioPort: number;
  /** `-v` sources for /data and /var/lib/tailscale: a docker named volume or a
   * host path under the pantry. There is a single data mount: MinIO runs
   * single-node (SNSD), which still supports Object Lock. */
  dataSource: string;
  stateSource: string;
  rootCredSecretRef: string;
  network: string;
  /** Publishes MinIO on the host loopback (`-p 127.0.0.1:<port>`). Only `host`
   * addressing sets this: a containerized manager reaches MinIO by container
   * name, so a publish would just collide. */
  publishHostPort: boolean;
  resources?: DockerResources;
}

export interface ContainerRuntime {
  /** Starts the instance container if absent; if it already exists, adopts it
   * and ensures it is running. */
  ensureInstance(spec: ContainerRunSpec): Promise<ContainerHandle>;

  /** Adopt-only start: starts an existing container if stopped, no-ops if
   * running, and throws if the container is absent. */
  ensureStarted(name: string): Promise<void>;

  status(name: string): Promise<ContainerState>;

  /** Inner-process health from the image's HEALTHCHECK, which requires both
   * tailscale to be connected and MinIO to be live. */
  health(name: string): Promise<InstanceHealth>;

  diagnose(name: string): Promise<InstanceDiagnostics>;

  /** No-op if the container is already stopped. */
  stop(name: string): Promise<void>;

  /** `removeVolume` also deletes the container's anonymous volumes; it is
   * irreversible, so only the confirmed offboard flow uses it. */
  remove(name: string, opts: { removeVolume: boolean }): Promise<void>;

  /** Best-effort: absent volumes are ignored. `docker rm -v` does NOT remove
   * named volumes, so teardown must call this explicitly. Irreversible. */
  removeVolumes(names: string[]): Promise<void>;

  /** Returns all p0rt1on-labelled containers. */
  list(): Promise<ContainerHandle[]>;
}

export interface InstanceRuntime {
  ensureInstance(spec: InstanceSpec): Promise<ContainerHandle>;

  adminEndpoint(instanceName: string, minioPort: number): string;

  /** The engine-specific identifier for the workload this runtime actually
   * provisioned for `instanceName` — what an operator would look up to debug it. */
  workloadName(instanceName: string): string;

  /** MUST be awaited after `ensureInstance` before any admin call, because
   * `docker run` returns before MinIO accepts connections. */
  waitUntilHealthy(instanceName: string): Promise<void>;

  /** Adopt-only start: starts the instance if stopped and throws if it is
   * absent. Pair with `waitUntilHealthy` so adoption never silently assumes
   * the instance works. */
  ensureRunning(instanceName: string): Promise<void>;

  diagnoseInstance(instanceName: string): Promise<InstanceDiagnostics>;

  /** A single health probe with no bounded wait. */
  instanceHealth(instanceName: string): Promise<InstanceHealth>;

  /** Does the persistent DATA still exist, independent of the container/pod?
   * Boot recovery keys off this: surviving data is recreated over, and missing
   * data is surfaced — never silently replaced with an empty instance. */
  hasData(instanceName: string): Promise<boolean>;

  /** Do the instance's credentials still exist, independent of the pod? On
   * Kubernetes they live in a Secret that can be deleted out from under a
   * running StatefulSet, leaving a pod that can never start. Always true on
   * docker, where the env-file is rewritten on every run. */
  hasCredentials(instanceName: string): Promise<boolean>;

  /** Returns every runtime-managed instance with its state; names are instance
   * (tailnet-hostname) names, not engine resource names. */
  listInstances(): Promise<{ name: string; state: ContainerState }[]>;

  stopInstance(instanceName: string): Promise<void>;

  /** Idempotent: "already absent" is success. */
  removeInstance(
    instanceName: string,
    opts: { removeData: boolean },
  ): Promise<void>;
}
