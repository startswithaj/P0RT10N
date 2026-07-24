import type {
  MintAuthKeyOptions,
  MintedAuthKey,
  TailnetNode,
  TailscaleApi,
} from "./tailscale.ts";
import { ManualAclRequiredError, ServiceError } from "../lib/ServiceError.ts";
import { manualAclInstructions } from "./manualAcl.ts";

// TailscaleApi over the Tailscale REST API v2 (fetch, injected for unit tests).
// Device + auth-key lifecycle and per-friend ACL grants: each friend tag
// granted access to ONLY its endpoint (grant src=tag → dst=endpoint) and added
// to tagOwners so its auth key can be minted. Policy edits use the ETag for
// optimistic concurrency.

const DEFAULT_BASE = "https://api.tailscale.com/api/v2";
/** A node seen within this window is treated as online (no realtime field). */
const ONLINE_WINDOW_MS = 15 * 60 * 1000;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface TailscaleConfig {
  /** API access token (Bearer). Supplied via env/secret, never persisted. */
  token: string;
  baseUrl?: string;
  /** Owner assigned to each friend tag in tagOwners (default autogroup:admin). */
  tagOwner?: string;
}

/** Raw device shape (subset) from GET /tailnet/{tailnet}/devices. */
interface ApiDevice {
  id: string;
  hostname: string;
  /** Full MagicDNS FQDN, e.g. `p0rt1on-alice.mouse-stairs.ts.net`. */
  name?: string;
  tags?: string[];
  lastSeen?: string;
  addresses?: string[];
  /** Owner login (email) for USER-owned devices; empty for tagged nodes. */
  user?: string;
}

/** One grant rule (modern policy model): src principals → dst destinations. */
interface AclGrant {
  src: string[];
  dst?: string[];
  ip?: string[];
}

/** The tailnet policy (loose — preserves any fields we don't touch). */
interface AclPolicy {
  tagOwners?: Record<string, string[]>;
  grants?: AclGrant[];
  [key: string]: unknown;
}

function sameSrc(grant: AclGrant, tag: string): boolean {
  return grant.src.length === 1 && grant.src[0] === tag;
}

function sameList(a: string[] = [], b: string[] = []): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Full semantic match (src + dst + ip) — a host-only match would let a
 * friend whose endpoint changed keep the stale grant AND gain a new one. */
function matchesGrant(g: AclGrant, want: AclGrant): boolean {
  return sameList(g.src, want.src) && sameList(g.dst, want.dst) &&
    sameList(g.ip, want.ip);
}

/** Bounded attempts for the ETag compare-and-swap on policy writes. */
const POLICY_CAS_ATTEMPTS = 3;

/** HTTP status → ServiceError code. 412 = ETag mismatch on a policy write
 * (concurrent edit) → CONFLICT, which updatePolicy treats as retryable. */
function codeForStatus(
  status: number,
): "FORBIDDEN" | "CONFLICT" | "INTERNAL_SERVER_ERROR" {
  if (status === 403) return "FORBIDDEN";
  if (status === 412) return "CONFLICT";
  return "INTERNAL_SERVER_ERROR";
}

/**
 * Split `host:port` for a grant. In Tailscale's grants model `dst` is a bare
 * hostname (a colon is rejected) and the port lives in `ip` as `proto:port`.
 */
export function splitHostPort(
  hostPort: string,
): { host: string; port: string } {
  const i = hostPort.lastIndexOf(":");
  return i > 0
    ? { host: hostPort.slice(0, i), port: hostPort.slice(i + 1) }
    : { host: hostPort, port: "443" };
}

export class TailscaleHttpApi implements TailscaleApi {
  private readonly base: string;
  // Cached OAuth access token (when `token` is a client secret). Access tokens
  // are short-lived, so we exchange lazily and refresh before expiry.
  private accessToken: string | null = null;
  private accessExpiresAt = 0;

  constructor(
    private readonly config: TailscaleConfig,
    private readonly fetchFn: FetchLike = globalThis.fetch,
    /** Injectable clock for the online-window heuristic (testability). */
    private readonly now: () => number = () => Date.now(),
  ) {
    this.base = config.baseUrl ?? DEFAULT_BASE;
  }

  async mintAuthKey(opts: MintAuthKeyOptions): Promise<MintedAuthKey> {
    const body = {
      capabilities: {
        devices: {
          create: {
            reusable: false,
            ephemeral: opts.ephemeral ?? false,
            preauthorized: true,
            tags: [opts.tag],
          },
        },
      },
      expirySeconds: opts.expirySeconds,
    };
    const json = await this.request("POST", `/tailnet/${this.tn()}/keys`, body);
    const key = json as { id: string; key: string; expires: string };
    return {
      key: key.key,
      keyId: key.id,
      tag: opts.tag,
      expiresAt: key.expires,
    };
  }

  async revokeAuthKey(keyId: string): Promise<void> {
    try {
      await this.request("DELETE", `/tailnet/${this.tn()}/keys/${keyId}`);
    } catch (err) {
      // Already revoked/expired is success (teardown idempotency house rule).
      if (err instanceof ServiceError && /\(404\)/.test(err.message)) return;
      throw err;
    }
  }

  async nodesByTag(tag: string): Promise<TailnetNode[]> {
    return (await this.listDevices())
      .filter((d) => (d.tags ?? []).includes(tag))
      .map((d) => ({
        nodeId: d.id,
        hostname: d.hostname,
        tags: d.tags ?? [],
        online: this.isFresh(d.lastSeen),
      }));
  }

  async hasJoined(email: string): Promise<boolean> {
    const want = email.toLowerCase();
    const users = await this.listUsersOrNull();
    if (users !== null) {
      return users.some((u) => u.loginName.toLowerCase() === want);
    }
    // No users:read scope (404) — fall back to devices: a user-owned device
    // carries its owner's login email, so a matching one means they've joined.
    return (await this.listDevices())
      .some((d) => (d.user ?? "").toLowerCase() === want);
  }

  private async listDevices(): Promise<ApiDevice[]> {
    const json = await this.request("GET", `/tailnet/${this.tn()}/devices`);
    return (json as { devices?: ApiDevice[] }).devices ?? [];
  }

  /** The tailnet's users, or null when the token lacks `users:read` (404). */
  private async listUsersOrNull(): Promise<{ loginName: string }[] | null> {
    try {
      const json = await this.request("GET", `/tailnet/${this.tn()}/users`);
      return (json as { users?: { loginName: string }[] }).users ?? [];
    } catch (err) {
      if (err instanceof ServiceError && /\(404\)/.test(err.message)) {
        return null;
      }
      throw err;
    }
  }

  async isNodeOnline(tag: string): Promise<boolean> {
    return (await this.nodesByTag(tag)).some((n) => n.online);
  }

  async nodeIpv4(hostname: string): Promise<string | null> {
    const json = await this.request("GET", `/tailnet/${this.tn()}/devices`);
    const devices = (json as { devices?: ApiDevice[] }).devices ?? [];
    const dev = devices.find((d) => d.hostname === hostname);
    return (dev?.addresses ?? []).find((a) => a.startsWith("100.")) ?? null;
  }

  async nodeFqdn(hostname: string): Promise<string | null> {
    // `name` is the node's full MagicDNS FQDN — the serve URL host, verbatim.
    const dev = (await this.listDevices()).find((d) => d.hostname === hostname);
    return dev?.name ?? null;
  }

  async deleteNode(nodeId: string): Promise<void> {
    await this.request("DELETE", `/device/${nodeId}`);
  }

  /** Grant `src` (tag or user email) access to ONLY `endpointHostPort`; own the
   * tag when `src` is one. Idempotent. A stale grant for the same friend
   * (endpoint changed) is replaced, not left to accumulate beside the new one. */
  async ensureFriendAcl(src: string, endpointHostPort: string): Promise<void> {
    const ownsTag = src.startsWith("tag:");
    try {
      const { host, port } = splitHostPort(endpointHostPort);
      const desired: AclGrant = {
        src: [src],
        dst: [host],
        ip: [`tcp:${port}`],
      };
      await this.updatePolicy((policy) => {
        const grants = policy.grants ?? [];
        const hasGrant = grants.some((g) => matchesGrant(g, desired));
        const hasOwner = !ownsTag || Boolean(policy.tagOwners?.[src]);
        if (hasGrant && hasOwner) return null; // already in place
        const tagOwners = { ...policy.tagOwners };
        if (ownsTag) {
          tagOwners[src] = policy.tagOwners?.[src] ?? [this.tagOwner()];
        }
        return {
          ...policy,
          tagOwners,
          grants: hasGrant
            ? grants
            : [...grants.filter((g) => !sameSrc(g, src)), desired],
        };
      });
    } catch (err) {
      // No policy_file write scope → tell the admin exactly what to paste.
      if (err instanceof ServiceError && err.code === "FORBIDDEN") {
        throw new ManualAclRequiredError(
          manualAclInstructions(src, endpointHostPort, this.tagOwner()),
        );
      }
      throw err;
    }
  }

  /** Declare `tag` in tagOwners (owned by the configured tagOwner) when absent.
   * Idempotent — a no-op once present, so it's cheap on every provision. */
  async ensureTagOwner(tag: string): Promise<void> {
    await this.updatePolicy((policy) => {
      if (policy.tagOwners?.[tag]) return null; // already declared
      return {
        ...policy,
        tagOwners: { ...policy.tagOwners, [tag]: [this.tagOwner()] },
      };
    });
  }

  /** MagicDNS enablement from GET /dns/preferences — the only readable signal
   * bearing on HTTPS-serve (MagicDNS is a prerequisite for cert issuance). */
  async magicDnsEnabled(): Promise<boolean> {
    const json = await this.request(
      "GET",
      `/tailnet/${this.tn()}/dns/preferences`,
    );
    return Boolean((json as { magicDNS?: boolean }).magicDNS);
  }

  /** HTTPS-certificate enablement — the definitive signal for serve --https.
   * GET /tailnet/-/settings → `httpsEnabled` (needs networking_settings:read). */
  async httpsCertsEnabled(): Promise<boolean> {
    const json = await this.request("GET", `/tailnet/${this.tn()}/settings`);
    return Boolean((json as { httpsEnabled?: boolean }).httpsEnabled);
  }

  /** Read-only check of tagOwners in the policy (reuses the ETag GET). */
  async isTagOwned(tag: string): Promise<boolean> {
    const { policy } = await this.getPolicy();
    return Boolean(policy.tagOwners?.[tag]);
  }

  /** Drop the friend's grant (and tag ownership, if a tag). Idempotent. */
  async removeFriendAcl(src: string): Promise<void> {
    await this.updatePolicy((policy) => {
      const grants = (policy.grants ?? []).filter((g) => !sameSrc(g, src));
      const tagOwners = { ...policy.tagOwners };
      if (src.startsWith("tag:")) delete tagOwners[src];
      return { ...policy, grants, tagOwners };
    });
  }

  // ---- helpers ----

  private tn(): string {
    // "-" is the API's alias for the token's own tailnet — an OAuth client is
    // bound to exactly one, so it never needs naming explicitly.
    return "-";
  }

  private tagOwner(): string {
    return this.config.tagOwner ?? "autogroup:admin";
  }

  /**
   * Read-modify-write on the policy, guarded by the ETag. On 412 (someone
   * else edited the policy between our GET and POST) re-fetch, re-apply the
   * mutation, and retry — bounded, then the conflict surfaces as-is.
   * `mutate` returning null means "nothing to change" (no POST).
   */
  private async updatePolicy(
    mutate: (policy: AclPolicy) => AclPolicy | null,
    attemptsLeft = POLICY_CAS_ATTEMPTS,
  ): Promise<void> {
    const { policy, etag } = await this.getPolicy();
    const next = mutate(policy);
    if (next === null) return;
    try {
      await this.setPolicy(next, etag);
    } catch (err) {
      if (
        err instanceof ServiceError && err.code === "CONFLICT" &&
        attemptsLeft > 1
      ) {
        return this.updatePolicy(mutate, attemptsLeft - 1);
      }
      throw err;
    }
  }

  /** GET the policy as JSON plus its ETag (for optimistic concurrency). */
  private async getPolicy(): Promise<{ policy: AclPolicy; etag: string }> {
    const path = `/tailnet/${this.tn()}/acl`;
    const res = await this.fetchFn(`${this.base}${path}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${await this.bearer()}`,
        "Accept": "application/json",
      },
    });
    await this.assertOk(res, "GET", path);
    const etag = res.headers.get("ETag") ?? "";
    const policy = (await res.json().catch(() => ({}))) as AclPolicy;
    return { policy, etag };
  }

  /** POST the updated policy back, guarded by the ETag. */
  private async setPolicy(policy: AclPolicy, etag: string): Promise<void> {
    const path = `/tailnet/${this.tn()}/acl`;
    const res = await this.fetchFn(`${this.base}${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${await this.bearer()}`,
        "Content-Type": "application/json",
        "If-Match": etag,
      },
      body: JSON.stringify(policy),
    });
    await this.assertOk(res, "POST", path);
  }

  private async assertOk(
    res: Response,
    method: string,
    path: string,
  ): Promise<void> {
    if (res.ok) return;
    const text = await res.text().catch(() => "");
    throw new ServiceError(
      codeForStatus(res.status),
      `tailscale ${method} ${path} failed (${res.status}): ${text}`,
    );
  }

  /**
   * The Bearer to send. An OAuth CLIENT SECRET (`tskey-client-…`) is NOT a valid
   * API token — it must be exchanged (client-credentials grant) for a short-lived
   * access token. A plain API token (`tskey-api-…`) is used as-is. Cached +
   * refreshed 60s before expiry.
   */
  private bearer(): Promise<string> {
    if (!this.config.token.startsWith("tskey-client-")) {
      return Promise.resolve(this.config.token);
    }
    if (this.accessToken && this.now() < this.accessExpiresAt) {
      return Promise.resolve(this.accessToken);
    }
    return this.exchangeToken();
  }

  /** POST the OAuth token endpoint; cache the access token + its expiry. */
  private async exchangeToken(): Promise<string> {
    // Client id is the 3rd dash-segment of `tskey-client-<id>-<secret>`.
    const clientId = this.config.token.split("-")[2] ?? "";
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: this.config.token,
    });
    const res = await this.fetchFn(`${this.base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `tailscale oauth token exchange failed (${res.status}): ${text}`,
      );
    }
    const json = await res.json().catch(() => ({})) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        "tailscale oauth: response had no access_token",
      );
    }
    const ttl = typeof json.expires_in === "number" ? json.expires_in : 3600;
    this.accessToken = json.access_token;
    this.accessExpiresAt = this.now() + Math.max(0, ttl - 60) * 1000;
    return json.access_token;
  }

  private isFresh(lastSeen?: string): boolean {
    if (!lastSeen) return false;
    const seen = Date.parse(lastSeen);
    return Number.isFinite(seen) && this.now() - seen < ONLINE_WINDOW_MS;
  }

  /** Authenticated request; throws ServiceError on non-2xx. Returns parsed JSON. */
  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${await this.bearer()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    await this.assertOk(res, method, path);
    if (res.status === 204) return undefined;
    return await res.json().catch(() => undefined);
  }
}
