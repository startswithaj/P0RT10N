import type { Logger, SystemHealthService } from "./types.ts";
import type { HealthCheck, SystemHealth } from "@p0rt1on/shared/domain";
import type { TailscaleApi } from "../tailscale/tailscale.ts";
import { ServiceError } from "../lib/ServiceError.ts";

// ============================================================================
// Boot preflight over the tailnet prerequisites a portion needs before anyone
// tries to create one. All of it is API-checkable, on boot, with no throwaway
// machine: MagicDNS (GET /dns/preferences, needs dns:read) and HTTPS certs
// (GET /tailnet/-/settings → httpsEnabled, needs networking_settings:read) are
// both read directly. A missing SCOPE (403) is surfaced as a warn — the API is
// reachable, we just can't verify — not a hard block. `reportServeUnavailable`
// stays as a runtime backstop if a real provision proves serve is off anyway.
// ============================================================================

/** Tailscale admin DNS page — where MagicDNS + HTTPS certificates live. */
const DNS_ADMIN_URL = "https://login.tailscale.com/admin/dns";

/** The alternative to enabling HTTPS: serve plain HTTP over the tailnet. Verified
 * escape hatch — the instance entrypoint runs `serve --http=80` (no cert) and the
 * healthcheck passes. WireGuard still encrypts the path. */
const HTTP_MODE_HINT =
  " Or set P0RT1ON_TAILSCALE_SERVE_MODE=http to serve plain HTTP over the " +
  "(still WireGuard-encrypted) tailnet instead.";

export interface SystemHealthConfig {
  serveMode: "https" | "http";
  serveNodeTag: string;
  aclMode: "auto" | "manual";
}

/** A boolean API read: the value, or a failure flagged as scope-missing (403)
 * vs a genuine reachability/credential error. */
type Read =
  | { ok: true; value: boolean }
  | { ok: false; forbidden: boolean; error: string };

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class TailnetSystemHealthService implements SystemHealthService {
  #latched: SystemHealth;
  /** Set once a real provision proves HTTPS-serve is off (runtime backstop). */
  #serveUnavailableReason: string | null = null;

  constructor(
    private readonly tailscale: TailscaleApi,
    private readonly config: SystemHealthConfig,
    private readonly logger: Logger,
    private readonly now: () => number = () => Date.now(),
  ) {
    // Optimistic until the boot probe runs — the probe is awaited before serve.
    this.#latched = {
      checks: [],
      canProvision: true,
      probedAt: new Date(this.now()).toISOString(),
    };
  }

  current(): SystemHealth {
    return this.#latched;
  }

  async probe(): Promise<SystemHealth> {
    const [magic, https] = await Promise.all([
      this.#read(() => this.tailscale.magicDnsEnabled()),
      this.#read(() => this.tailscale.httpsCertsEnabled()),
    ]);
    return this.#latch([
      this.#apiCheck(magic, https),
      this.#magicDnsCheck(magic),
      await this.#serveTagCheck(),
      this.#httpsServeCheck(https),
    ]);
  }

  reportServeUnavailable(reason: string): void {
    if (this.config.serveMode === "http") return; // moot when serving HTTP
    this.#serveUnavailableReason = reason;
    this.logger.warn(
      "system health: HTTPS serve unavailable — gating portion creation",
      { reason },
    );
    const others = this.#latched.checks.filter((c) => c.id !== "httpsServe");
    // The reason short-circuits the check, so the read arg is unused here.
    this.#latch([...others, this.#httpsServeCheck({ ok: true, value: false })]);
  }

  /** Run a boolean API read, classifying failures as scope-missing (403) vs a
   * reachability/credential error. */
  async #read(fn: () => Promise<boolean>): Promise<Read> {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      const forbidden = err instanceof ServiceError && err.code === "FORBIDDEN";
      return { ok: false, forbidden, error: errMsg(err) };
    }
  }

  #apiCheck(magic: Read, https: Read): HealthCheck {
    // A 403 means the API is reachable and the creds are valid, just missing a
    // scope — reachability only fails when neither call got even that far.
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

  #magicDnsCheck(magic: Read): HealthCheck {
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

  async #serveTagCheck(): Promise<HealthCheck> {
    const tag = this.config.serveNodeTag;
    // A read error surfaces as a string (never a boolean) → warn, don't block.
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
    // Manual ACL mode: the admin declares tags by hand — never write here.
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
    // Auto mode: create it now — idempotent, and pre-warms provisioning.
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

  #httpsServeCheck(https: Read): HealthCheck {
    if (this.config.serveMode === "http") {
      return {
        id: "httpsServe",
        status: "ok",
        title: "Serve mode",
        detail:
          "Plain HTTP over the tailnet (P0RT1ON_TAILSCALE_SERVE_MODE=http).",
      };
    }
    if (this.#serveUnavailableReason) {
      return {
        id: "httpsServe",
        status: "blocked",
        title: "HTTPS serve not enabled",
        detail:
          `A provision failed because tailscale serve --https isn't enabled ` +
          `on the tailnet (${this.#serveUnavailableReason}). Enable HTTPS ` +
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

  #latch(checks: HealthCheck[]): SystemHealth {
    const health: SystemHealth = {
      checks,
      canProvision: !checks.some((c) => c.status === "blocked"),
      probedAt: new Date(this.now()).toISOString(),
    };
    this.#latched = health;
    return health;
  }
}
