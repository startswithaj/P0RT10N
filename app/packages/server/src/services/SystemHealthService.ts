import type { Logger, SystemHealthService } from "./types.ts";
import type { HealthCheck, SystemHealth } from "@p0rt1on/shared/domain";
import type { TailscaleApi } from "../tailscale/tailscale.ts";
import type { Env } from "../lib/Env.ts";
import type { RestClient } from "@cloudydeno/kubernetes-client";
import { CoreV1Api } from "@cloudydeno/kubernetes-apis/core/v1";
import { toQuantity } from "@cloudydeno/kubernetes-apis/common.ts";
import { ServiceError } from "../lib/ServiceError.ts";

// A missing OAuth scope (403) means the API is reachable but unverifiable, so
// it is classified as a warn rather than a hard block.

const DNS_ADMIN_URL = "https://login.tailscale.com/admin/dns";

/** Plain HTTP is a verified fallback: `tailscale serve --http=80` still runs
 * over WireGuard-encrypted transport, so it is not actually insecure. */
const HTTP_MODE_HINT =
  " Or set P0RT1ON_TAILSCALE_SERVE_MODE=http to serve plain HTTP over the " +
  "(still WireGuard-encrypted) tailnet instead.";

/** Resolves the manager's own k8s Service; absent on the docker runtime. */
export type ManagerServiceProbe =
  | { ok: true; service: string; namespace: string }
  | { ok: false; service: string; namespace: string; error: string };

/** Checks the pantry isn't also the cluster's default StorageClass; absent on
 * the docker runtime, where the pantry is a host path.
 *
 * Deliberately does NOT check the class exists. Reading a StorageClass needs a
 * cluster-scoped grant, and the manager holds none — so instead it submits a
 * PVC that names no class at all and reads back whichever class admission
 * fills in. That needs only the namespaced PVC permission it already has, and
 * creates nothing. A class that doesn't exist can't be caught this way: the
 * API accepts a PVC naming a missing class and only fails later, so that case
 * is reported at provisioning time from the PVC's own events instead. */
export type PantryProbe =
  | { ok: true; className: string; clusterDefault: string | null }
  | { ok: false; className: string; reason: "is-default" }
  | { ok: false; className: string; reason: "unverifiable"; error: string };

export interface SystemHealthConfig {
  serveMode: "https" | "http";
  serveNodeTag: string;
  aclMode: "auto" | "manual";
  /** A plain config value, not Kubernetes behavior: this service still never
   * calls a Kubernetes API directly, it just knows which runtime is active. */
  runtimeKind: "docker" | "kubernetes";
  instanceImage: string;
  /** k8s-backed probes; absent on the docker runtime so those checks are
   * omitted entirely rather than reporting a false "ok". app.ts composes the
   * real implementations so this service stays decoupled from Kubernetes. */
  probeManagerService?: () => Promise<ManagerServiceProbe>;
  probePantry?: () => Promise<PantryProbe>;
}

type Read =
  | { ok: true; value: boolean }
  | { ok: false; forbidden: boolean; error: string };

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Docker resolves an unqualified image the same way: no explicit registry
 * host in the first path segment means it resolves to docker.io. */
function hasRegistryHost(image: string): boolean {
  const [first, ...rest] = image.split("/");
  if (rest.length === 0) return false;
  return first.includes(".") || first.includes(":") || first === "localhost";
}

/** cloudydeno throws an Error carrying the HTTP status as `httpCode`. */
/** The Kubernetes-backed probes behind the k8s checks below. Absent on the
 * docker runtime, where those checks are omitted entirely rather than
 * reported as passing. Exported for direct unit testing against a fake
 * `RestClient`, since a real one needs a live cluster. */
export function buildHealthProbes(
  env: Env,
  kubeClient: RestClient | undefined,
): {
  probeManagerService?: () => Promise<ManagerServiceProbe>;
  probePantry?: () => Promise<PantryProbe>;
} {
  if (env.runtimeKind !== "kubernetes" || !kubeClient) return {};
  const settings = env.kubeSettings();
  const core = new CoreV1Api(kubeClient);

  return {
    probeManagerService: async () => {
      const service = settings.managerServiceName;
      const namespace = settings.namespace;
      try {
        await core.namespace(namespace).getService(service);
        return { ok: true, service, namespace };
      } catch (err) {
        return { ok: false, service, namespace, error: errMsg(err) };
      }
    },
    probePantry: async () => {
      const className = env.pantry;
      try {
        // dryRun runs admission and discards the object, so this reads the
        // cluster default without creating a PVC or leaving one behind. The
        // DefaultStorageClass admission plugin is what fills in the name.
        const probe = await core.namespace(settings.namespace)
          .createPersistentVolumeClaim({
            metadata: { name: "p0rt1on-pantry-default-probe" },
            spec: {
              accessModes: ["ReadWriteOnce"],
              resources: { requests: { storage: toQuantity("1Mi") } },
            },
          }, { dryRun: "All" });
        const clusterDefault = probe.spec?.storageClassName ?? null;
        return clusterDefault === className
          ? { ok: false, className, reason: "is-default" } as const
          : { ok: true, className, clusterDefault } as const;
      } catch (err) {
        return {
          ok: false,
          className,
          reason: "unverifiable",
          error: errMsg(err),
        } as const;
      }
    },
  };
}

export class SystemHealthServiceImpl implements SystemHealthService {
  private latched: SystemHealth;
  /** Set once a real provision proves HTTPS-serve is off (runtime backstop). */
  private serveUnavailableReason: string | null = null;

  constructor(
    private readonly tailscale: TailscaleApi,
    private readonly config: SystemHealthConfig,
    private readonly logger: Logger,
    private readonly now: () => number = () => Date.now(),
  ) {
    // Optimistic default until the boot probe runs, since the probe is awaited before the server starts serving.
    this.latched = {
      checks: [],
      canProvision: true,
      probedAt: new Date(this.now()).toISOString(),
    };
  }

  current(): SystemHealth {
    return this.latched;
  }

  async probe(): Promise<SystemHealth> {
    const [magic, https] = await Promise.all([
      this.read(() => this.tailscale.magicDnsEnabled()),
      this.read(() => this.tailscale.httpsCertsEnabled()),
    ]);
    const [managerService, pantry] = await Promise.all([
      this.managerServiceCheck(),
      this.pantryCheck(),
    ]);
    const checks = [
      this.apiCheck(magic, https),
      this.magicDnsCheck(magic),
      await this.serveTagCheck(),
      this.httpsServeCheck(https),
      this.instanceImageCheck(),
      managerService,
      pantry,
    ].filter((c): c is HealthCheck => c !== null);
    return this.latch(checks);
  }

  reportServeUnavailable(reason: string): void {
    if (this.config.serveMode === "http") return; // moot when serving HTTP
    this.serveUnavailableReason = reason;
    this.logger.warn(
      "system health: HTTPS serve unavailable — gating portion creation",
      { reason },
    );
    const others = this.latched.checks.filter((c) => c.id !== "httpsServe");
    // The reason short-circuits the check, so the read arg is unused here.
    this.latch([...others, this.httpsServeCheck({ ok: true, value: false })]);
  }

  private async read(fn: () => Promise<boolean>): Promise<Read> {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      const forbidden = err instanceof ServiceError && err.code === "FORBIDDEN";
      return { ok: false, forbidden, error: errMsg(err) };
    }
  }

  private apiCheck(magic: Read, https: Read): HealthCheck {
    // A 403 means the API is reachable and credentials are valid, just missing
    // a scope, so reachability only fails when neither call gets even that far.
    const reachable = [magic, https].some((r) => r.ok || r.forbidden);
    if (reachable) {
      return {
        id: "tailscaleApi",
        status: "ok",
        title: "Tailscale API",
        detail: "Reachable; credentials accepted.",
      };
    }
    const err = magic.ok ? "unknown" : magic.error;
    return {
      id: "tailscaleApi",
      status: "blocked",
      title: "Tailscale API unreachable",
      detail:
        `Can't reach the Tailscale API or the credentials were rejected: ${err}. ` +
        `Check P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET.`,
    };
  }

  private magicDnsCheck(magic: Read): HealthCheck {
    if (this.config.serveMode === "http") {
      return {
        id: "magicDns",
        status: "ok",
        title: "MagicDNS",
        detail: "Not required — instances serve plain HTTP by config.",
      };
    }
    if (!magic.ok) {
      const detail = magic.forbidden
        ? "Grant the OAuth client `dns:read` to verify MagicDNS is enabled."
        : `Couldn't read DNS preferences: ${magic.error}.`;
      return {
        id: "magicDns",
        status: "warn",
        title: "MagicDNS",
        detail,
        fixUrl: DNS_ADMIN_URL,
      };
    }
    if (!magic.value) {
      return {
        id: "magicDns",
        status: "blocked",
        title: "MagicDNS is off",
        detail:
          "Instances serve over HTTPS, which requires MagicDNS then HTTPS " +
          "certificates. MagicDNS is off, so every provision will fail — " +
          "enable both in the Tailscale admin console (login.tailscale.com → " +
          "DNS)." + HTTP_MODE_HINT,
        fixUrl: DNS_ADMIN_URL,
      };
    }
    return {
      id: "magicDns",
      status: "ok",
      title: "MagicDNS",
      detail: "Enabled (the HTTPS-certificate prerequisite is met).",
    };
  }

  private async serveTagCheck(): Promise<HealthCheck> {
    const tag = this.config.serveNodeTag;
    // A read error surfaces as a string rather than a boolean, so that case is treated as a warn, not a block.
    const owned = await this.tailscale.isTagOwned(tag).catch((err) =>
      errMsg(err)
    );
    if (typeof owned === "string") {
      return {
        id: "serveTag",
        status: "warn",
        title: "Serve tag",
        detail: `Couldn't read the tailnet policy: ${owned}.`,
        fixUrl: DNS_ADMIN_URL,
      };
    }
    if (owned) {
      return {
        id: "serveTag",
        status: "ok",
        title: "Serve tag",
        detail: `${tag} is declared in tagOwners.`,
      };
    }
    // In manual ACL mode the admin declares tags by hand, so this code must never write to the policy.
    if (this.config.aclMode === "manual") {
      return {
        id: "serveTag",
        status: "blocked",
        title: "Serve tag missing",
        detail:
          `Manual ACL mode: declare ${tag} (owner tag:p0rt1on) in your policy. ` +
          `The app won't write it, and provisioning can't mint the serve key ` +
          `without it.`,
        fixUrl: DNS_ADMIN_URL,
      };
    }
    // In auto mode the tag is created immediately since the operation is idempotent and pre-warms provisioning.
    try {
      await this.tailscale.ensureTagOwner(tag);
      return {
        id: "serveTag",
        status: "ok",
        title: "Serve tag",
        detail: `Declared ${tag} in tagOwners.`,
      };
    } catch (err) {
      const forbidden = err instanceof ServiceError && err.code === "FORBIDDEN";
      const detail = forbidden
        ? `The OAuth client lacks policy-file write, so ${tag} can't be declared automatically. Grant Policy File → Write, or set P0RT1ON_TAILSCALE_ACL_MODE=manual and declare it by hand.`
        : `Failed to declare ${tag}: ${errMsg(err)}.`;
      return {
        id: "serveTag",
        status: "blocked",
        title: "Can't create serve tag",
        detail,
        fixUrl: DNS_ADMIN_URL,
      };
    }
  }

  private httpsServeCheck(https: Read): HealthCheck {
    if (this.config.serveMode === "http") {
      return {
        id: "httpsServe",
        status: "ok",
        title: "Serve mode",
        detail:
          "Plain HTTP over the tailnet (P0RT1ON_TAILSCALE_SERVE_MODE=http).",
      };
    }
    if (this.serveUnavailableReason) {
      return {
        id: "httpsServe",
        status: "blocked",
        title: "HTTPS serve not enabled",
        detail:
          `A provision failed because tailscale serve --https isn't enabled ` +
          `on the tailnet (${this.serveUnavailableReason}). Enable HTTPS ` +
          `Certificates in the Tailscale admin console (login.tailscale.com → ` +
          `DNS).` + HTTP_MODE_HINT,
        fixUrl: DNS_ADMIN_URL,
      };
    }
    if (!https.ok) {
      const detail = https.forbidden
        ? "Grant the OAuth client `networking_settings:read` to verify HTTPS certificates are enabled; until then a failed provision is the only signal."
        : `Couldn't read tailnet settings: ${https.error}.`;
      return {
        id: "httpsServe",
        status: "warn",
        title: "HTTPS certificates",
        detail,
        fixUrl: DNS_ADMIN_URL,
      };
    }
    if (!https.value) {
      return {
        id: "httpsServe",
        status: "blocked",
        title: "HTTPS certificates are off",
        detail:
          "Instances serve over HTTPS but your tailnet has HTTPS certificates " +
          "disabled — every provision will fail. Enable it in the Tailscale " +
          "admin console (login.tailscale.com → DNS → HTTPS Certificates; " +
          "MagicDNS must be on first)." + HTTP_MODE_HINT,
        fixUrl: DNS_ADMIN_URL,
      };
    }
    return {
      id: "httpsServe",
      status: "ok",
      title: "HTTPS certificates",
      detail: "Enabled — tailscale serve --https will work.",
    };
  }

  private instanceImageCheck(): HealthCheck | null {
    // Not applicable on docker: the daemon resolves the same way, but there's
    // no private-registry deployment path there to warn about.
    if (this.config.runtimeKind !== "kubernetes") return null;
    const image = this.config.instanceImage;
    if (hasRegistryHost(image)) {
      return {
        id: "instanceImage",
        status: "ok",
        title: "Instance image",
        detail:
          `P0RT1ON_INSTANCE_IMAGE (${image}) names an explicit registry host.`,
      };
    }
    return {
      id: "instanceImage",
      status: "warn",
      title: "Instance image has no registry host",
      detail:
        `P0RT1ON_INSTANCE_IMAGE is "${image}", which has no registry host and ` +
        `will resolve to docker.io. If you're using a private registry, ` +
        `qualify the image (e.g. registry.example.com/${image}).`,
    };
  }

  private async managerServiceCheck(): Promise<HealthCheck | null> {
    if (!this.config.probeManagerService) return null; // docker: no Service to resolve
    const r = await this.config.probeManagerService();
    if (r.ok) {
      return {
        id: "managerService",
        status: "ok",
        title: "Manager Service",
        detail: `Resolved Service ${r.service} in namespace ${r.namespace}.`,
      };
    }
    return {
      id: "managerService",
      status: "blocked",
      title: "Manager Service not found",
      detail:
        `Couldn't resolve Service ${r.service} in namespace ${r.namespace}: ` +
        `${r.error}. Every portion is handed an audit webhook URL built from ` +
        `this name — check P0RT1ON_K8S_MANAGER_SERVICE_NAME.`,
    };
  }

  private async pantryCheck(): Promise<HealthCheck | null> {
    if (!this.config.probePantry) return null; // docker: the pantry is a host path
    const r = await this.config.probePantry();
    if (r.ok) {
      return {
        id: "pantry",
        status: "ok",
        title: "Pantry",
        detail:
          `StorageClass ${r.className} (P0RT1ON_PANTRY) isn't the cluster ` +
          `default (that's ${r.clusterDefault ?? "unset"}), so portion data ` +
          `stays on its own storage. Whether the class exists and has a live ` +
          `provisioner isn't checked here — a provisioning failure reports ` +
          `that from the PVC's own events.`,
      };
    }
    if (r.reason === "is-default") {
      return {
        id: "pantry",
        status: "blocked",
        title: "Pantry is the cluster default",
        detail:
          `StorageClass ${r.className} (P0RT1ON_PANTRY) is the cluster's ` +
          `default StorageClass. Portion data would share the default path ` +
          `with unrelated volumes — remove its ` +
          `storageclass.kubernetes.io/is-default-class annotation or point ` +
          `P0RT1ON_PANTRY elsewhere.`,
      };
    }
    return {
      id: "pantry",
      status: "warn",
      title: "Pantry — can't verify",
      detail:
        `StorageClass ${r.className} (P0RT1ON_PANTRY) couldn't be read: ${r.error}.`,
    };
  }

  private latch(checks: HealthCheck[]): SystemHealth {
    const health: SystemHealth = {
      checks,
      canProvision: !checks.some((c) => c.status === "blocked"),
      probedAt: new Date(this.now()).toISOString(),
    };
    this.latched = health;
    return health;
  }
}
