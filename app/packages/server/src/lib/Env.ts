import type { LogLevel } from "../services/types.ts";
import type { ProvisioningConfig } from "../provisioning/deps.ts";

// ============================================================================
// The single place every environment variable is read. Construct once at boot
// (`new Env()`); pass it where config is needed. Tests inject a fake source, so
// nothing else in the app touches `Deno.env` directly.
// ============================================================================

/** Where raw values come from — real env by default, a map in tests. */
export interface EnvSource {
  get(key: string): string | undefined;
}

const denoSource: EnvSource = { get: (k) => Deno.env.get(k) };
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * Vars the app cannot run without, validated at construction. Master key:
 * every instance root credential (and the audit token) derives from it.
 * The control-plane credential is backend-dependent (checked in the
 * constructor): every add/suspend/offboard calls the API — no stub, no
 * fallback; a manager without it could only fail later and worse.
 */
const REQUIRED_VARS = [
  "P0RT1ON_MASTER_KEY",
] as const;

export class Env {
  constructor(private readonly src: EnvSource = denoSource) {
    const perBackend: readonly string[] = this.tailscaleBackend === "headscale"
      ? ["HEADSCALE_URL", "HEADSCALE_API_KEY"]
      : ["TAILSCALE_OAUTH_CLIENT_SECRET"];
    const missing = [...REQUIRED_VARS, ...perBackend]
      .filter((k) => this.#opt(k) === undefined);
    if (missing.length > 0) {
      throw new Error(`${missing.join(", ")} is not set`);
    }
  }

  /** A REQUIRED_VARS value — the constructor guarantees it exists. */
  #required(key: string): string {
    const v = this.#opt(key);
    if (v === undefined) throw new Error(`${key} is not set`);
    return v;
  }

  #str(key: string, fallback: string): string {
    const v = this.src.get(key);
    return v && v.length > 0 ? v : fallback;
  }
  #num(key: string, fallback: number): number {
    const v = this.src.get(key);
    if (!v || v.length === 0) return fallback;
    const n = Number(v);
    // Fail loudly at boot — a NaN here surfaces later as an unrelated crash
    // (e.g. MINIO_PORT_MIN=abc reads as "no free port" on every add).
    if (!Number.isFinite(n)) {
      throw new Error(`${key} must be a number, got "${v}"`);
    }
    return n;
  }
  #opt(key: string): string | undefined {
    const v = this.src.get(key);
    return v && v.length > 0 ? v : undefined;
  }

  // ---- process / logging ----
  get logLevel(): LogLevel {
    const raw = this.src.get("LOG_LEVEL");
    return LOG_LEVELS.includes(raw as LogLevel) ? raw as LogLevel : "info";
  }
  get port(): number {
    return this.#num("PORT", 8080);
  }
  /**
   * The audit-webhook listener's port. Its own listener (not the admin one)
   * so instance containers can POST events while the admin API stays on
   * loopback — the two must not collide, checked here so a misconfig fails
   * at boot with a clear message.
   */
  get auditPort(): number {
    const p = this.#num("AUDIT_PORT", 8081);
    if (p === this.port) {
      throw new Error(
        `AUDIT_PORT (${p}) must differ from PORT (${this.port}) — the audit ` +
          `webhook gets its own network-exposed listener; the admin API stays ` +
          `loopback-only`,
      );
    }
    return p;
  }
  /** Audit listener bind address; `0.0.0.0` in-container is conventional —
   * the host port publish (compose) controls real exposure. */
  get auditBindHost(): string {
    return this.#str("AUDIT_BIND_HOST", "0.0.0.0");
  }
  get dbPath(): string {
    return this.#str("DB_PATH", "./data/p0rt1on.db");
  }
  /** Docker network instances join — a docker-runtime detail, so it feeds
   * DockerInstanceRuntime directly, not ProvisioningConfig. */
  get dockerNetwork(): string {
    return this.#str("P0RT1ON_NETWORK", "p0rt1on-net");
  }

  // ---- runtime selection ----
  /** Which InstanceRuntime realizes instances. Docker stays the default. */
  get runtimeKind(): "docker" | "kubernetes" {
    return this.#str("RUNTIME", "docker") === "kubernetes"
      ? "kubernetes"
      : "docker";
  }
  /**
   * Kubernetes runtime settings. `apiBase`/`token`/`caFile` are dev/explicit
   * overrides; when all are unset the client auto-detects the mounted
   * in-cluster ServiceAccount (token + CA + server) itself.
   */
  kubeSettings(): {
    namespace: string;
    apiBase?: string;
    tokenInline?: string;
    caFile?: string;
    dataSize: string;
    stateSize: string;
    storageClass?: string;
    resources: {
      cpuRequest?: string;
      cpuLimit?: string;
      memoryRequest?: string;
      memoryLimit?: string;
    };
  } {
    return {
      namespace: this.#str("K8S_NAMESPACE", "p0rt1on"),
      apiBase: this.#opt("K8S_API"),
      tokenInline: this.#opt("K8S_TOKEN"),
      caFile: this.#opt("K8S_CA_FILE"),
      dataSize: this.#str("K8S_DATA_SIZE", "50Gi"),
      stateSize: this.#str("K8S_STATE_SIZE", "1Gi"),
      storageClass: this.#opt("K8S_STORAGE_CLASS"),
      // Per-portion container CPU/memory (native k8s values, all optional).
      resources: {
        cpuRequest: this.#opt("PORTION_K8S_CPU_REQUEST"),
        cpuLimit: this.#opt("PORTION_K8S_CPU_LIMIT"),
        memoryRequest: this.#opt("PORTION_K8S_MEMORY_REQUEST"),
        memoryLimit: this.#opt("PORTION_K8S_MEMORY_LIMIT"),
      },
    };
  }

  /** Per-portion docker resource caps → `docker run` flags (all optional). */
  dockerPortionResources(): {
    cpuShares?: string;
    cpus?: string;
    memoryReservation?: string;
    memoryLimit?: string;
  } {
    return {
      cpuShares: this.#opt("PORTION_DOCKER_CPU_REQUEST"),
      cpus: this.#opt("PORTION_DOCKER_CPU_LIMIT"),
      memoryReservation: this.#opt("PORTION_DOCKER_MEMORY_REQUEST"),
      memoryLimit: this.#opt("PORTION_DOCKER_MEMORY_LIMIT"),
    };
  }
  /**
   * Built SPA assets dir to serve (production image sets this). Unset in dev —
   * the Vite dev server serves the frontend instead, so the API only does tRPC.
   */
  get staticDir(): string | undefined {
    return this.#opt("STATIC_DIR");
  }

  // ---- secrets ----
  /**
   * Master key all instance root creds (and the audit token) derive from.
   * Keep it stable + backed up — losing or changing it loses admin access
   * to every instance.
   */
  get masterKey(): string {
    return this.#required("P0RT1ON_MASTER_KEY");
  }

  // ---- Tailscale ----
  /** OAuth client secret for the Tailscale API. */
  get tailscaleOauthClientSecret(): string {
    return this.#required("TAILSCALE_OAUTH_CLIENT_SECRET");
  }
  get tagOwner(): string | undefined {
    return this.#opt("TAILSCALE_TAG_OWNER");
  }
  /** Which control plane the manager talks to. `headscale` is the self-hosted
   * test-tier backend — see HeadscaleHttpApi for what it can't do (HTTPS certs). */
  get tailscaleBackend(): "tailscale" | "headscale" {
    return this.#str("TAILSCALE_BACKEND", "tailscale") === "headscale"
      ? "headscale"
      : "tailscale";
  }
  headscaleSettings(): { baseUrl: string; apiKey: string; user: string } {
    return {
      baseUrl: this.#required("HEADSCALE_URL"),
      apiKey: this.#required("HEADSCALE_API_KEY"),
      user: this.#str("HEADSCALE_USER", "p0rt1on"),
    };
  }
  /** Instance enrollment extras: headscale needs an explicit login server, and
   * without cert issuance `tailscale serve` must fall back to plain HTTP
   * (WireGuard still encrypts the path). Empty loginServer = SaaS default. */
  instanceTailscale(): { loginServer?: string; serveMode: "https" | "http" } {
    return {
      loginServer: this.#opt("TAILSCALE_LOGIN_SERVER"),
      serveMode: this.#str("TAILSCALE_SERVE_MODE", "https") === "http"
        ? "http"
        : "https",
    };
  }

  /**
   * Everything the provisioning stack needs, with dev-friendly defaults —
   * except `auditWebhookToken`, which is DERIVED from the master key, not
   * env-sourced; app.ts composes it in.
   */
  provisioningConfig(): Omit<ProvisioningConfig, "auditWebhookToken"> {
    return {
      instanceImage: this.#str("INSTANCE_IMAGE", "p0rt1on-instance:latest"),
      // `host` (default): host-run manager reaches the loopback-published
      // port. `network`: containerized manager reaches instances by container
      // name over the shared docker network — published loopback ports are
      // unreachable cross-container on Linux (host.docker.internal included).
      instanceAddressing: this.#str("INSTANCE_ADDRESSING", "host") === "network"
        ? "network"
        : "host",
      region: this.#str("S3_REGION", "us-east-1"),
      portRange: {
        min: this.#num("MINIO_PORT_MIN", 9100),
        max: this.#num("MINIO_PORT_MAX", 9999),
      },
      sharedInstanceName: this.#str("SHARED_INSTANCE_NAME", "pool"),
      tailnetDomain: this.#str("TAILNET_DOMAIN", "example.ts.net"),
      // Same source as the instance's TAILSCALE_SERVE_MODE — the friend
      // endpoint scheme + ACL grant port must match how instances serve.
      serveMode: this.instanceTailscale().serveMode,
      serveNodeTag: this.#str("SERVE_NODE_TAG", "tag:p0rt1on-serve"),
      aclMode: this.#str("TAILSCALE_ACL_MODE", "auto") === "manual"
        ? "manual"
        : "auto",
      // Instances (containers) POST audit events here — reach the manager via
      // the host gateway, not loopback (which would be the instance itself).
      // Points at the dedicated audit listener, never the admin port.
      auditWebhookUrl: this.#str(
        "AUDIT_WEBHOOK_URL",
        `http://host.docker.internal:${this.auditPort}/internal/audit`,
      ),
    };
  }
}
