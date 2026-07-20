import type { LogLevel } from "../services/types.ts";
import type { ProvisioningConfig } from "../provisioning/deps.ts";

// ============================================================================
// The single place every environment variable is read. Construct once at boot
// (`new Env()`); pass it where config is needed. Tests inject a fake source, so
// nothing else in the app touches `Deno.env` directly.
// ============================================================================

/**
 * Every setting p0rt1on can be configured with. A name that is not here is not
 * configurable: it is one of the constants below, or a constant next to the
 * code that uses it.
 */
export enum EnvVar {
  MasterKey = "P0RT1ON_MASTER_KEY",
  LogLevel = "P0RT1ON_LOG_LEVEL",
  Port = "P0RT1ON_PORT",
  DbPath = "P0RT1ON_DB_PATH",
  AdminUsername = "P0RT1ON_ADMIN_USERNAME",
  AdminPassword = "P0RT1ON_ADMIN_PASSWORD",
  AdminBindHost = "P0RT1ON_ADMIN_BIND_HOST",
  MinioForwardUrl = "P0RT1ON_MINIO_FORWARD_URL",
  MinioForwardAuthorization = "P0RT1ON_MINIO_FORWARD_AUTHORIZATION",
  Runtime = "P0RT1ON_RUNTIME",
  InstanceImage = "P0RT1ON_INSTANCE_IMAGE",
  InstanceAddressing = "P0RT1ON_INSTANCE_ADDRESSING",
  SharedInstanceName = "P0RT1ON_SHARED_INSTANCE_NAME",
  TailscaleOauthClientSecret = "P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET",
  TailscaleTagOwner = "P0RT1ON_TAILSCALE_TAG_OWNER",
  TailscaleTailnetDomain = "P0RT1ON_TAILSCALE_TAILNET_DOMAIN",
  TailscaleServeNodeTag = "P0RT1ON_TAILSCALE_SERVE_NODE_TAG",
  TailscaleAclMode = "P0RT1ON_TAILSCALE_ACL_MODE",
  TailscaleBackend = "P0RT1ON_TAILSCALE_BACKEND",
  TailscaleLoginServer = "P0RT1ON_TAILSCALE_LOGIN_SERVER",
  TailscaleServeMode = "P0RT1ON_TAILSCALE_SERVE_MODE",
  HeadscaleUrl = "P0RT1ON_HEADSCALE_URL",
  HeadscaleApiKey = "P0RT1ON_HEADSCALE_API_KEY",
  HeadscaleUser = "P0RT1ON_HEADSCALE_USER",
  K8sNamespace = "P0RT1ON_K8S_NAMESPACE",
  K8sApi = "P0RT1ON_K8S_API",
  K8sToken = "P0RT1ON_K8S_TOKEN",
  K8sCaFile = "P0RT1ON_K8S_CA_FILE",
  K8sDataSize = "P0RT1ON_K8S_DATA_SIZE",
  K8sStateSize = "P0RT1ON_K8S_STATE_SIZE",
  K8sStorageClass = "P0RT1ON_K8S_STORAGE_CLASS",
  PortionDockerCpuRequest = "P0RT1ON_PORTION_DOCKER_CPU_REQUEST",
  PortionDockerCpuLimit = "P0RT1ON_PORTION_DOCKER_CPU_LIMIT",
  PortionDockerMemoryRequest = "P0RT1ON_PORTION_DOCKER_MEMORY_REQUEST",
  PortionDockerMemoryLimit = "P0RT1ON_PORTION_DOCKER_MEMORY_LIMIT",
  PortionK8sCpuRequest = "P0RT1ON_PORTION_K8S_CPU_REQUEST",
  PortionK8sCpuLimit = "P0RT1ON_PORTION_K8S_CPU_LIMIT",
  PortionK8sMemoryRequest = "P0RT1ON_PORTION_K8S_MEMORY_REQUEST",
  PortionK8sMemoryLimit = "P0RT1ON_PORTION_K8S_MEMORY_LIMIT",
}

/** Path instances POST audit events to, on the listener below. */
export const MINIO_EVENT_PATH = "/internal/minio-events";
/**
 * The audit listener's port. Fixed: it is the manager talking to its own
 * instances, and both deployments publish 8081 (docker-compose.yml, deploy/k8s).
 */
export const EVENT_PORT = 8081;
/** The audit listener binds outward so instance containers can reach it; what
 * is actually exposed is decided by the published ports. */
export const EVENT_BIND_HOST = "0.0.0.0";
/** Service name the manager answers on in-cluster (deploy/k8s/p0rt1on.yaml). */
const K8S_MANAGER_SERVICE = "p0rt1on-manager";
/**
 * Host ports dedicated instances are allocated from. The allocator skips ports
 * already in the database and bind-probes the rest, so the range only has to be
 * wide enough, not tuned.
 */
const PORT_RANGE = { min: 9100, max: 9999 };

/** Where raw values come from — real env by default, a map in tests. */
export interface EnvSource {
  get(key: string): string | undefined;
}

const denoSource: EnvSource = { get: (k) => Deno.env.get(k) };
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * Vars the app cannot run without, validated at construction. Master key:
 * every instance root credential (and the audit token) derives from it. Tailnet
 * domain: every friend endpoint is built from it, so a wrong value fails only
 * later, on the friend's machine. The control-plane credential is
 * backend-dependent (checked in the constructor): every add/suspend/offboard
 * calls the API — no stub, no fallback; a manager without it could only fail
 * later and worse.
 */
const REQUIRED_VARS: readonly EnvVar[] = [
  EnvVar.MasterKey,
  EnvVar.TailscaleTailnetDomain,
] as const;

export class Env {
  constructor(private readonly src: EnvSource = denoSource) {
    const perBackend: readonly EnvVar[] = this.tailscaleBackend === "headscale"
      ? [EnvVar.HeadscaleUrl, EnvVar.HeadscaleApiKey]
      : [EnvVar.TailscaleOauthClientSecret];
    const missing = [...REQUIRED_VARS, ...perBackend]
      .filter((k) => this.#opt(k) === undefined);
    if (missing.length > 0) {
      throw new Error(`${missing.join(", ")} is not set`);
    }
  }

  /** A REQUIRED_VARS value — the constructor guarantees it exists. */
  #required(key: EnvVar): string {
    const v = this.#opt(key);
    if (v === undefined) throw new Error(`${key} is not set`);
    return v;
  }

  #str(key: EnvVar, fallback: string): string {
    const v = this.src.get(key);
    return v && v.length > 0 ? v : fallback;
  }
  #num(key: EnvVar, fallback: number): number {
    const v = this.src.get(key);
    if (!v || v.length === 0) return fallback;
    const n = Number(v);
    // Fail loudly at boot — a NaN here surfaces later as an unrelated crash
    // (e.g. a bad port reads as "no free port" on every add).
    if (!Number.isFinite(n)) {
      throw new Error(`${key} must be a number, got "${v}"`);
    }
    return n;
  }
  #opt(key: EnvVar): string | undefined {
    const v = this.src.get(key);
    return v && v.length > 0 ? v : undefined;
  }

  // ---- process / logging ----
  get logLevel(): LogLevel {
    const raw = this.src.get(EnvVar.LogLevel);
    return LOG_LEVELS.includes(raw as LogLevel) ? raw as LogLevel : "info";
  }
  /**
   * The admin API's port. It must differ from the audit listener's fixed port:
   * the admin API stays loopback-only while the audit listener faces the
   * container network, so a collision would expose the admin surface. Checked
   * here so a misconfig fails at boot with a clear message.
   */
  get port(): number {
    const p = this.#num(EnvVar.Port, 8080);
    if (p === EVENT_PORT) {
      throw new Error(
        `${EnvVar.Port} (${p}) must differ from the audit listener's port ` +
          `(${EVENT_PORT})`,
      );
    }
    return p;
  }

  // ---- MinIO event forwarding ----
  /** Operator webhook to forward every MinIO event to, byte-identical. Unset →
   * forwarding disabled (no forwarder attached). */
  get minioForwardUrl(): string | undefined {
    return this.#opt(EnvVar.MinioForwardUrl);
  }
  /** Sent verbatim as the Authorization header on forwarded events. Secret —
   * env-only, never logged (prefer this over a token in the URL). */
  get minioForwardAuthorization(): string | undefined {
    return this.#opt(EnvVar.MinioForwardAuthorization);
  }

  // ---- admin auth ----
  /** Admin credentials from env; null → auth disabled (loopback-only bind). */
  get adminAuth(): { username: string; password: string } | null {
    const username = this.#opt(EnvVar.AdminUsername);
    const password = this.#opt(EnvVar.AdminPassword);
    return username && password ? { username, password } : null;
  }
  /** Admin listener bind. Non-loopback is refused unless auth is enabled
   * (the boot guard) — a bare admin API must never face the network. */
  get adminBindHost(): string {
    return this.#str(EnvVar.AdminBindHost, "127.0.0.1");
  }
  get dbPath(): string {
    return this.#str(EnvVar.DbPath, "./data/p0rt1on.db");
  }

  // ---- runtime selection ----
  /** Which InstanceRuntime realizes instances. Docker stays the default. */
  get runtimeKind(): "docker" | "kubernetes" {
    return this.#str(EnvVar.Runtime, "docker") === "kubernetes"
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
      namespace: this.#str(EnvVar.K8sNamespace, "p0rt1on"),
      apiBase: this.#opt(EnvVar.K8sApi),
      tokenInline: this.#opt(EnvVar.K8sToken),
      caFile: this.#opt(EnvVar.K8sCaFile),
      dataSize: this.#str(EnvVar.K8sDataSize, "50Gi"),
      stateSize: this.#str(EnvVar.K8sStateSize, "1Gi"),
      storageClass: this.#opt(EnvVar.K8sStorageClass),
      // Per-portion container CPU/memory (native k8s values, all optional).
      resources: {
        cpuRequest: this.#opt(EnvVar.PortionK8sCpuRequest),
        cpuLimit: this.#opt(EnvVar.PortionK8sCpuLimit),
        memoryRequest: this.#opt(EnvVar.PortionK8sMemoryRequest),
        memoryLimit: this.#opt(EnvVar.PortionK8sMemoryLimit),
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
      cpuShares: this.#opt(EnvVar.PortionDockerCpuRequest),
      cpus: this.#opt(EnvVar.PortionDockerCpuLimit),
      memoryReservation: this.#opt(EnvVar.PortionDockerMemoryRequest),
      memoryLimit: this.#opt(EnvVar.PortionDockerMemoryLimit),
    };
  }

  // ---- secrets ----
  /**
   * Master key all instance root creds (and the audit token) derive from.
   * Keep it stable + backed up — losing or changing it loses admin access
   * to every instance.
   */
  get masterKey(): string {
    return this.#required(EnvVar.MasterKey);
  }

  // ---- Tailscale ----
  /** OAuth client secret for the Tailscale API. */
  get tailscaleOauthClientSecret(): string {
    return this.#required(EnvVar.TailscaleOauthClientSecret);
  }
  /**
   * Who owns each friend tag in the policy's `tagOwners` (e.g. `tag:p0rt1on`).
   * REQUIRED on the real Tailscale backend: the manager authenticates as the
   * OAuth client, and Tailscale only mints keys for tags that client OWNS — so
   * the API's `autogroup:admin` fallback always 400s ("requested tags are
   * invalid or not permitted"), and only at the authkey step, AFTER the
   * instance container is up. Fail at boot instead. Headscale derives its own
   * default, so it stays optional there.
   */
  get tagOwner(): string | undefined {
    return this.tailscaleBackend === "tailscale"
      ? this.#required(EnvVar.TailscaleTagOwner)
      : this.#opt(EnvVar.TailscaleTagOwner);
  }
  /** Which control plane the manager talks to. `headscale` is the self-hosted
   * test-tier backend — see HeadscaleHttpApi for what it can't do (HTTPS certs). */
  get tailscaleBackend(): "tailscale" | "headscale" {
    return this.#str(EnvVar.TailscaleBackend, "tailscale") === "headscale"
      ? "headscale"
      : "tailscale";
  }
  headscaleSettings(): { baseUrl: string; apiKey: string; user: string } {
    return {
      baseUrl: this.#required(EnvVar.HeadscaleUrl),
      apiKey: this.#required(EnvVar.HeadscaleApiKey),
      user: this.#str(EnvVar.HeadscaleUser, "p0rt1on"),
    };
  }
  /** Instance enrollment extras: headscale needs an explicit login server, and
   * without cert issuance `tailscale serve` must fall back to plain HTTP
   * (WireGuard still encrypts the path). Empty loginServer = SaaS default. */
  instanceTailscale(): { loginServer?: string; serveMode: "https" | "http" } {
    return {
      loginServer: this.#opt(EnvVar.TailscaleLoginServer),
      serveMode: this.#str(EnvVar.TailscaleServeMode, "https") === "http"
        ? "http"
        : "https",
    };
  }

  /**
   * Where instances POST audit events. Derived, not configured: it is the
   * manager's own listener, and how an instance reaches it depends only on
   * where the two are running. Never 127.0.0.1 — that would be the instance.
   */
  #auditWebhookUrl(): string {
    const host = this.runtimeKind === "kubernetes"
      ? `${K8S_MANAGER_SERVICE}.${this.kubeSettings().namespace}.svc`
      : "host.docker.internal";
    return `http://${host}:${EVENT_PORT}${MINIO_EVENT_PATH}`;
  }

  /**
   * Everything the provisioning stack needs, with dev-friendly defaults —
   * except `auditWebhookToken`, which is DERIVED from the master key, not
   * env-sourced; app.ts composes it in.
   */
  provisioningConfig(): Omit<ProvisioningConfig, "auditWebhookToken"> {
    return {
      instanceImage: this.#str(EnvVar.InstanceImage, "p0rt1on-instance:latest"),
      // `host` (default): host-run manager reaches the loopback-published
      // port. `network`: containerized manager reaches instances by container
      // name over the shared docker network — published loopback ports are
      // unreachable cross-container on Linux.
      instanceAddressing:
        this.#str(EnvVar.InstanceAddressing, "host") === "network"
          ? "network"
          : "host",
      portRange: PORT_RANGE,
      sharedInstanceName: this.#str(EnvVar.SharedInstanceName, "pool"),
      tailnetDomain: this.#required(EnvVar.TailscaleTailnetDomain),
      // Same source as the instance's TAILSCALE_SERVE_MODE — the friend
      // endpoint scheme + ACL grant port must match how instances serve.
      serveMode: this.instanceTailscale().serveMode,
      serveNodeTag: this.#str(
        EnvVar.TailscaleServeNodeTag,
        "tag:p0rt1on-serve",
      ),
      aclMode: this.#str(EnvVar.TailscaleAclMode, "auto") === "manual"
        ? "manual"
        : "auto",
      auditWebhookUrl: this.#auditWebhookUrl(),
    };
  }
}
