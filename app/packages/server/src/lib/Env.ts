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

export class Env {
  constructor(private readonly src: EnvSource = denoSource) {}

  #str(key: string, fallback: string): string {
    const v = this.src.get(key);
    return v && v.length > 0 ? v : fallback;
  }
  #num(key: string, fallback: number): number {
    const v = this.src.get(key);
    return v && v.length > 0 ? Number(v) : fallback;
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
  /** Bind address; `0.0.0.0` in a container so instances can reach the webhook. */
  get bindHost(): string {
    return this.#str("BIND_HOST", "127.0.0.1");
  }
  get dbPath(): string {
    return this.#str("DB_PATH", "./data/p0rt1on.db");
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
   * Master key all instance root creds derive from. REQUIRED — throws on boot if
   * unset, because a missing/insecure key silently breaks admin access to every
   * instance. Set it (K8s secret / mounted file) and never lose or change it.
   */
  requireMasterKey(): string {
    const key = this.#opt("P0RT1ON_MASTER_KEY");
    if (!key) {
      throw new Error(
        "P0RT1ON_MASTER_KEY is required: every instance's MinIO root credential " +
          "is derived from it. Set it (K8s secret / mounted file) and keep it " +
          "stable + backed up — losing or changing it loses admin access to all " +
          "instances.",
      );
    }
    return key;
  }

  // ---- Tailscale ----
  /** OAuth client secret; undefined ⇒ run with the stub. */
  get tailscaleToken(): string | undefined {
    return this.#opt("TS_API_TOKEN");
  }
  get tailnet(): string {
    return this.#str("TS_TAILNET", "-");
  }
  get tagOwner(): string | undefined {
    return this.#opt("TS_TAG_OWNER");
  }

  // ---- audit webhook ----
  get auditWebhookToken(): string {
    return this.#str("AUDIT_WEBHOOK_TOKEN", "change-me");
  }

  /** Everything the provisioning stack needs, with dev-friendly defaults. */
  provisioningConfig(): ProvisioningConfig {
    return {
      instanceImage: this.#str("INSTANCE_IMAGE", "p0rt1on-instance:latest"),
      network: this.#str("P0RT1ON_NETWORK", "p0rt1on-net"),
      instanceHost: this.#str("INSTANCE_HOST", "127.0.0.1"),
      region: this.#str("S3_REGION", "us-east-1"),
      portRange: {
        min: this.#num("MINIO_PORT_MIN", 9100),
        max: this.#num("MINIO_PORT_MAX", 9999),
      },
      sharedInstanceName: this.#str("SHARED_INSTANCE_NAME", "pool"),
      tailnetDomain: this.#str("TAILNET_DOMAIN", "example.ts.net"),
      serveNodeTag: this.#str("SERVE_NODE_TAG", "tag:p0rt1on-serve"),
      aclMode: this.#str("TS_ACL_MODE", "auto") === "manual"
        ? "manual"
        : "auto",
      // Instances (containers) POST audit events here — reach the manager via
      // the host gateway, not loopback (which would be the instance itself).
      auditWebhookUrl: this.#str(
        "AUDIT_WEBHOOK_URL",
        "http://host.docker.internal:8080/internal/audit",
      ),
      auditWebhookToken: this.auditWebhookToken,
    };
  }
}
