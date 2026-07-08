// ============================================================================
// Container lifecycle — start/stop/remove the per-instance container. Each
// instance is ONE container running MinIO + tailscaled together (see
// `instance/`). Runtime-agnostic (Docker/Podman/etc.) behind one interface. All
// "ensure" methods are IDEMPOTENT and keyed on container name: re-running adopts
// the existing container rather than starting a second, so a crash mid-provision
// is safe to retry and the shared pool is started at most once.
// ============================================================================

/** Lifecycle state of a container, as the runtime reports it. */
export type ContainerState = "running" | "stopped" | "absent";

/** Inner-process health of an instance (from the image's HEALTHCHECK). */
export type InstanceHealth = "healthy" | "unhealthy" | "starting" | "unknown";

/** A reference to a launched container. */
export interface ContainerHandle {
  name: string;
  id: string;
  state: ContainerState;
}

/**
 * Enough to answer "what's wrong with this instance?" without shelling in:
 * lifecycle state, health + the last health-probe reason (which of tailscale /
 * MinIO failed), the exit code/error if it died, and a tail of the container's
 * logs. Assembled from `docker inspect` + `docker logs`.
 */
export interface InstanceDiagnostics {
  name: string;
  state: ContainerState;
  health: InstanceHealth;
  /** Last line the HEALTHCHECK printed, e.g. "minio not live" — null if none. */
  healthReason: string | null;
  /** Exit code / error, meaningful when the container has stopped. */
  exitCode: number | null;
  exitError: string | null;
  /** Recent stdout+stderr (docker logs --tail). */
  recentLogs: string;
}

/**
 * Spec for one instance container (MinIO + tailscaled in a single image — see
 * `instance/`). `rootCredSecretRef` names a mounted env-file carrying the
 * MinIO root creds AND the just-minted single-use TAILSCALE_AUTHKEY (path
 * only — no secret ever on argv or in the DB). `image` is pinned. The
 * container joins `network` (the admin plane: the manager reaches MinIO at
 * `http://<name>:<minioPort>`); friends reach it over Tailscale.
 */
export interface InstanceSpec {
  name: string;
  image: string;
  tsHostname: string;
  tag: string;
  minioPort: number;
  /** Single data volume mounted at /data (MinIO SNSD — lock-capable). */
  dataVolume: string;
  stateVolume: string;
  rootCredSecretRef: string;
  network: string;
}

/**
 * Abstracts the container engine. Implementations shell out to docker/podman (or
 * talk to its socket). Methods throw a ServiceError on engine failure.
 */
export interface ContainerRuntime {
  /** Start the instance container if absent; adopt + ensure running if it exists. */
  ensureInstance(spec: InstanceSpec): Promise<ContainerHandle>;

  /**
   * Adopt-only start: start an EXISTING container if stopped; no-op if
   * running; absent → throw. Never invents a container — that's
   * ensureInstance's job, with a full spec.
   */
  ensureStarted(name: string): Promise<void>;

  /** Current lifecycle state without mutating — drives idempotency + reconcile. */
  status(name: string): Promise<ContainerState>;

  /** Inner-process health (tailscale connected AND MinIO live) from HEALTHCHECK. */
  health(name: string): Promise<InstanceHealth>;

  /** Full diagnostics (state + health reason + exit + recent logs) for debugging. */
  diagnose(name: string): Promise<InstanceDiagnostics>;

  /** Stop a container (suspend / dedicated offboard); no-op if already stopped. */
  stop(name: string): Promise<void>;

  /**
   * Remove a container. `removeVolume` also deletes its anonymous volumes — used
   * only on offboard, after confirm. Irreversible.
   */
  remove(name: string, opts: { removeVolume: boolean }): Promise<void>;

  /**
   * Delete named volumes (the per-instance data + state volumes). Best-effort:
   * ignores volumes that are absent. `docker rm -v` does NOT remove named
   * volumes, so teardown must call this explicitly. Irreversible.
   */
  removeVolumes(names: string[]): Promise<void>;

  /**
   * All p0rt1on-managed containers (filtered by a label). Lets the boot-time
   * reconcile sweep find containers the DB doesn't know about (or vice versa).
   */
  list(): Promise<ContainerHandle[]>;
}

/**
 * Higher-level helper over ContainerRuntime keyed on the instance name (tailnet
 * hostname): derives the container + volume names so the provisioning/offboard
 * flows don't build container names themselves.
 */
export interface InstanceRuntime {
  /** Ensure the instance container is up; returns its handle. */
  ensureInstance(spec: InstanceSpec): Promise<ContainerHandle>;

  /**
   * Block until the instance's HEALTHCHECK reports healthy (MinIO live + tailnet
   * up), or throw after a timeout. MUST be awaited after `ensureInstance` before
   * any admin call — `docker run` returns before MinIO is accepting connections.
   */
  waitUntilHealthy(instanceName: string): Promise<void>;

  /**
   * Adopt-only start: the instance container must already
   * exist — start it if stopped, throw if absent. Pair with
   * `waitUntilHealthy` so adopting an existing instance never silently
   * assumes it works.
   */
  ensureRunning(instanceName: string): Promise<void>;

  /** Diagnostics for an instance by its hostname (state + health + logs). */
  diagnoseInstance(instanceName: string): Promise<InstanceDiagnostics>;

  /** Stop the instance container (dedicated suspend). */
  stopInstance(instanceName: string): Promise<void>;

  /** Remove the instance container; `removeVolumes` for offboard teardown. */
  removeInstance(
    instanceName: string,
    opts: { removeVolumes: boolean },
  ): Promise<void>;
}
