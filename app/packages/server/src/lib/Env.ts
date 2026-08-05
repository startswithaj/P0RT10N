import { isAbsolute, relative, resolve } from "@std/path";
import type { LogLevel } from "../services/types.ts";
import type { ProvisioningConfig } from "../provisioning/deps.ts";

// Tests inject a fake source; nothing outside this class touches `Deno.env`
// directly.

export enum EnvVar {
  MasterKey = "P0RT1ON_MASTER_KEY",
  Pantry = "P0RT1ON_PANTRY",
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
  TailscaleServeNodeTag = "P0RT1ON_TAILSCALE_SERVE_NODE_TAG",
  TailscaleAclMode = "P0RT1ON_TAILSCALE_ACL_MODE",
  TailscaleBackend = "P0RT1ON_TAILSCALE_BACKEND",
  TailscaleServeMode = "P0RT1ON_TAILSCALE_SERVE_MODE",
  TailscaleApiToken = "P0RT1ON_TAILSCALE_API_TOKEN",
  HeadscaleUrl = "P0RT1ON_HEADSCALE_URL",
  HeadscaleApiKey = "P0RT1ON_HEADSCALE_API_KEY",
  HeadscaleUser = "P0RT1ON_HEADSCALE_USER",
  HeadscaleBaseDomain = "P0RT1ON_HEADSCALE_BASE_DOMAIN",
  K8sNamespace = "P0RT1ON_K8S_NAMESPACE",
  K8sApi = "P0RT1ON_K8S_API",
  K8sToken = "P0RT1ON_K8S_TOKEN",
  K8sCaFile = "P0RT1ON_K8S_CA_FILE",
  K8sDataSize = "P0RT1ON_K8S_DATA_SIZE",
  K8sStateSize = "P0RT1ON_K8S_STATE_SIZE",
  K8sManagerServiceName = "P0RT1ON_K8S_MANAGER_SERVICE_NAME",
  PortionDockerCpuRequest = "P0RT1ON_PORTION_DOCKER_CPU_REQUEST",
  PortionDockerCpuLimit = "P0RT1ON_PORTION_DOCKER_CPU_LIMIT",
  PortionDockerMemoryRequest = "P0RT1ON_PORTION_DOCKER_MEMORY_REQUEST",
  PortionDockerMemoryLimit = "P0RT1ON_PORTION_DOCKER_MEMORY_LIMIT",
  PortionK8sCpuRequest = "P0RT1ON_PORTION_K8S_CPU_REQUEST",
  PortionK8sCpuLimit = "P0RT1ON_PORTION_K8S_CPU_LIMIT",
  PortionK8sMemoryRequest = "P0RT1ON_PORTION_K8S_MEMORY_REQUEST",
  PortionK8sMemoryLimit = "P0RT1ON_PORTION_K8S_MEMORY_LIMIT",
}

export const MINIO_EVENT_PATH = "/internal/minio-events";
/** Fixed rather than configurable: only the manager's own instances call it,
 * and both deployments publish 8081 (docker-compose.yml, deploy/k8s). */
export const EVENT_PORT = 8081;
/** The audit listener binds outward so instance containers can reach it; what
 * is actually exposed is decided by the published ports. */
export const EVENT_BIND_HOST = "0.0.0.0";
/** Host ports dedicated instances are allocated from. The allocator skips DB-known
 * ports and bind-probes the rest, so the range only has to be wide enough, not tuned. */
const PORT_RANGE = { min: 9100, max: 9999 };

export interface EnvSource {
  get(key: string): string | undefined;
}

const denoSource: EnvSource = { get: (k) => Deno.env.get(k) };
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/** The control-plane credential is backend-dependent; a manager without it
 * would only fail later and worse. */
const REQUIRED_VARS: readonly EnvVar[] = [
  EnvVar.MasterKey,
  EnvVar.Pantry,
] as const;

/** Required only when the backend is headscale (base_domain can't be read from
 * headscale's API, so the manager must be told it). */
const HEADSCALE_REQUIRED_VARS: readonly EnvVar[] = [
  EnvVar.HeadscaleUrl,
  EnvVar.HeadscaleApiKey,
  EnvVar.HeadscaleBaseDomain,
] as const;

/** Required only under the kubernetes runtime. Every instance is handed this
 * Service name inside its audit webhook URL, and a wrong one breaks audit
 * delivery silently and permanently — so it must be stated, never assumed. */
const KUBERNETES_REQUIRED_VARS: readonly EnvVar[] = [
  EnvVar.K8sManagerServiceName,
] as const;

export class Env {
  constructor(private readonly src: EnvSource = denoSource) {
    const perBackend: readonly EnvVar[] = this.tailscaleBackend === "headscale"
      ? HEADSCALE_REQUIRED_VARS
      : [EnvVar.TailscaleOauthClientSecret];
    const perRuntime: readonly EnvVar[] = this.runtimeKind === "kubernetes"
      ? KUBERNETES_REQUIRED_VARS
      : [];
    const missing = [...REQUIRED_VARS, ...perBackend, ...perRuntime]
      .filter((k) => this.opt(k) === undefined);
    if (missing.length > 0) {
      throw new Error(`${missing.join(", ")} is not set`);
    }
  }

  private required(key: EnvVar): string {
    const v = this.opt(key);
    if (v === undefined) throw new Error(`${key} is not set`);
    return v;
  }

  private str(key: EnvVar, fallback: string): string {
    const v = this.src.get(key);
    return v && v.length > 0 ? v : fallback;
  }
  private num(key: EnvVar, fallback: number): number {
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
  private opt(key: EnvVar): string | undefined {
    const v = this.src.get(key);
    return v && v.length > 0 ? v : undefined;
  }

  // ---- process / logging ----
  get logLevel(): LogLevel {
    const raw = this.src.get(EnvVar.LogLevel);
    return LOG_LEVELS.includes(raw as LogLevel) ? raw as LogLevel : "info";
  }
  /** Must differ from the audit listener's port: the admin API stays loopback-only while
   * the audit listener faces the container network — a collision would expose the admin surface. */
  get port(): number {
    const p = this.num(EnvVar.Port, 8080);
    if (p === EVENT_PORT) {
      throw new Error(
        `${EnvVar.Port} (${p}) must differ from the audit listener's port ` +
          `(${EVENT_PORT})`,
      );
    }
    return p;
  }

  // ---- MinIO event forwarding ----
  /** An operator webhook every MinIO event is forwarded to byte-identically;
   * unset disables forwarding. */
  get minioForwardUrl(): string | undefined {
    return this.opt(EnvVar.MinioForwardUrl);
  }
  /** Sent verbatim as the Authorization header on forwarded events. It is a
   * secret: env-only, never logged, and preferred over a token in the URL. */
  get minioForwardAuthorization(): string | undefined {
    return this.opt(EnvVar.MinioForwardAuthorization);
  }

  // ---- admin auth ----
  /** Null disables auth; pairing that with a non-loopback bind only triggers
   * a startup warning (main.ts), it is not restricted. */
  get adminAuth(): { username: string; password: string } | null {
    const username = this.opt(EnvVar.AdminUsername);
    const password = this.opt(EnvVar.AdminPassword);
    return username && password ? { username, password } : null;
  }
  get adminBindHost(): string {
    return this.str(EnvVar.AdminBindHost, "127.0.0.1");
  }
  get dbPath(): string {
    return this.str(EnvVar.DbPath, "./data/p0rt1on.db");
  }
  /** On docker an absolute host directory ($PANTRY/<instance>); on k8s a
   * StorageClass name. Required in both. */
  get pantry(): string {
    const value = this.required(EnvVar.Pantry);
    if (this.runtimeKind === "kubernetes") {
      if (value.startsWith("/")) {
        throw new Error(
          `${EnvVar.Pantry} on kubernetes is a StorageClass name, not a ` +
            `path (got "${value}")`,
        );
      }
      return value;
    }
    // The manager's own DB must not live inside the pantry — its lifecycle
    // differs, and offboard `rm -rf`s a subtree.
    if (!isAbsolute(value)) {
      throw new Error(
        `${EnvVar.Pantry} must be an absolute path, got "${value}"`,
      );
    }
    const rel = relative(value, resolve(this.dbPath));
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
      throw new Error(
        `${EnvVar.DbPath} (${this.dbPath}) must not live inside ` +
          `${EnvVar.Pantry} (${value})`,
      );
    }
    return value;
  }

  // ---- runtime selection ----
  get runtimeKind(): "docker" | "kubernetes" {
    return this.str(EnvVar.Runtime, "docker") === "kubernetes"
      ? "kubernetes"
      : "docker";
  }
  /** `apiBase`/`token`/`caFile` are dev/explicit overrides; when unset the client
   * auto-detects the mounted in-cluster ServiceAccount (token + CA + server). */
  kubeSettings(): {
    namespace: string;
    apiBase?: string;
    tokenInline?: string;
    caFile?: string;
    dataSize: string;
    stateSize: string;
    managerServiceName: string;
    resources: {
      cpuRequest?: string;
      cpuLimit?: string;
      memoryRequest?: string;
      memoryLimit?: string;
    };
  } {
    return {
      namespace: this.str(EnvVar.K8sNamespace, "p0rt1on"),
      apiBase: this.opt(EnvVar.K8sApi),
      tokenInline: this.opt(EnvVar.K8sToken),
      caFile: this.opt(EnvVar.K8sCaFile),
      dataSize: this.str(EnvVar.K8sDataSize, "50Gi"),
      stateSize: this.str(EnvVar.K8sStateSize, "1Gi"),
      managerServiceName: this.required(EnvVar.K8sManagerServiceName),
      resources: {
        cpuRequest: this.opt(EnvVar.PortionK8sCpuRequest),
        cpuLimit: this.opt(EnvVar.PortionK8sCpuLimit),
        memoryRequest: this.opt(EnvVar.PortionK8sMemoryRequest),
        memoryLimit: this.opt(EnvVar.PortionK8sMemoryLimit),
      },
    };
  }

  /** Per-portion docker resource caps, passed through as `docker run` flags. */
  dockerPortionResources(): {
    cpuShares?: string;
    cpus?: string;
    memoryReservation?: string;
    memoryLimit?: string;
  } {
    return {
      cpuShares: this.opt(EnvVar.PortionDockerCpuRequest),
      cpus: this.opt(EnvVar.PortionDockerCpuLimit),
      memoryReservation: this.opt(EnvVar.PortionDockerMemoryRequest),
      memoryLimit: this.opt(EnvVar.PortionDockerMemoryLimit),
    };
  }

  // ---- secrets ----
  /** All instance root creds (and the audit token) derive from it. Keep it
   * stable and backed up — losing or changing it loses admin access to every
   * instance. */
  get masterKey(): string {
    return this.required(EnvVar.MasterKey);
  }

  // ---- Tailscale ----
  get tailscaleOauthClientSecret(): string {
    return this.required(EnvVar.TailscaleOauthClientSecret);
  }
  /** Optional, and deliberately separate from the OAuth client: user-invites
   * need a user-owned token, which OAuth clients are not. When unset, invites
   * fall back to manual console steps. */
  get tailscaleApiToken(): string | undefined {
    return this.opt(EnvVar.TailscaleApiToken);
  }
  /** Required on the real Tailscale backend: keys mint only for tags the OAuth
   * client owns, and the fallback owner 400s at the authkey step after the
   * container is already up — so fail at boot instead. Headscale derives its
   * own default, so it is optional there. */
  get tagOwner(): string | undefined {
    return this.tailscaleBackend === "tailscale"
      ? this.required(EnvVar.TailscaleTagOwner)
      : this.opt(EnvVar.TailscaleTagOwner);
  }
  /** `headscale` is the self-hosted test-tier backend — see HeadscaleHttpApi
   * for what it can't do (HTTPS certs). */
  get tailscaleBackend(): "tailscale" | "headscale" {
    return this.str(EnvVar.TailscaleBackend, "tailscale") === "headscale"
      ? "headscale"
      : "tailscale";
  }
  headscaleSettings(): {
    baseUrl: string;
    apiKey: string;
    user: string;
    baseDomain: string;
  } {
    return {
      baseUrl: this.required(EnvVar.HeadscaleUrl),
      apiKey: this.required(EnvVar.HeadscaleApiKey),
      user: this.str(EnvVar.HeadscaleUser, "p0rt1on"),
      baseDomain: this.required(EnvVar.HeadscaleBaseDomain),
    };
  }
  /** Headscale needs an explicit login server, derived from its API base rather
   * than configured twice. Without cert issuance `tailscale serve` falls back
   * to plain HTTP (WireGuard still encrypts the path). */
  instanceTailscale(): { loginServer?: string; serveMode: "https" | "http" } {
    return {
      loginServer: this.tailscaleBackend === "headscale"
        ? this.headscaleSettings().baseUrl
        : undefined,
      serveMode: this.str(EnvVar.TailscaleServeMode, "https") === "http"
        ? "http"
        : "https",
    };
  }

  /** Derived, not configured: it is the manager's own listener. Never
   * 127.0.0.1 — that would be the instance itself. */
  private auditWebhookUrl(): string {
    const host = this.runtimeKind === "kubernetes"
      ? `${this.kubeSettings().managerServiceName}.${this.kubeSettings().namespace}.svc`
      : "host.docker.internal";
    return `http://${host}:${EVENT_PORT}${MINIO_EVENT_PATH}`;
  }

  /** `auditWebhookToken` is DERIVED from the master key, not env-sourced;
   * app.ts composes it in. */
  provisioningConfig(): Omit<ProvisioningConfig, "auditWebhookToken"> {
    return {
      instanceImage: this.str(EnvVar.InstanceImage, "p0rt1on-instance:latest"),
      // `network` means a containerized manager reaching instances by container
      // name — published loopback ports are unreachable cross-container.
      instanceAddressing:
        this.str(EnvVar.InstanceAddressing, "host") === "network"
          ? "network"
          : "host",
      portRange: PORT_RANGE,
      sharedInstanceName: this.str(EnvVar.SharedInstanceName, "pool"),
      // Same source as the instance's TAILSCALE_SERVE_MODE: the friend endpoint
      // scheme and the ACL grant port must match how instances serve.
      serveMode: this.instanceTailscale().serveMode,
      serveNodeTag: this.str(
        EnvVar.TailscaleServeNodeTag,
        "tag:p0rt1on-serve",
      ),
      aclMode: this.str(EnvVar.TailscaleAclMode, "auto") === "manual"
        ? "manual"
        : "auto",
      auditWebhookUrl: this.auditWebhookUrl(),
    };
  }
}
