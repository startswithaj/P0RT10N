import type {
  MintAuthKeyOptions,
  MintedAuthKey,
  TailnetNode,
  TailscaleApi,
} from "./tailscale.ts";
import type { FetchLike } from "./TailscaleHttpApi.ts";
import { splitHostPort } from "./TailscaleHttpApi.ts";
import { ServiceError } from "../lib/ServiceError.ts";

// TailscaleApi over the headscale v1 REST API — the test-tier backend (real
// tailscaled + WireGuard, no Tailscale account). Diffs from Tailscale: plain
// API-key bearer; USER-scoped preauth keys expired by string not id; real
// online boolean; classic acls policy (no grants) requiring policy.mode:database,
// no ETag. No HTTPS certs → serve is HTTP-only.

export interface HeadscaleConfig {
  /** Headscale base URL, e.g. `http://headscale.p0rt1on.svc:8080`. */
  baseUrl: string;
  /** API key from `headscale apikeys create`. Env/secret only, never persisted. */
  apiKey: string;
  /** Headscale user that owns all minted preauth keys. */
  user: string;
  /** Owner for friend tags in tagOwners (default `<user>@`). */
  tagOwner?: string;
  /** MagicDNS base domain (headscale's `base_domain`), e.g. `p0rt1on.test`.
   * Headscale's API doesn't expose it — unlike Tailscale, where it's read from
   * a node's FQDN — so the test harness supplies it via config. */
  baseDomain: string;
}

/** Node shape (subset) from GET /api/v1/node. */
interface HsNode {
  id: string;
  givenName: string;
  ipAddresses?: string[];
  /** 0.29+ reports one resolved `tags`; older servers split the same set
   * across forcedTags/validTags. */
  tags?: string[];
  forcedTags?: string[];
  validTags?: string[];
  online?: boolean;
}

/** Preauth key shape (subset) from POST /api/v1/preauthkey and its list. */
interface HsPreAuthKey {
  id: string;
  key: string;
  expiration: string;
}

/** One classic ACL rule: src tags → `host:port` destinations. */
interface AclRule {
  action: "accept";
  src: string[];
  dst: string[];
}

/** The policy document (loose — preserves fields we don't touch). */
interface AclPolicy {
  tagOwners?: Record<string, string[]>;
  acls?: AclRule[];
  [key: string]: unknown;
}

const DEFAULT_KEY_EXPIRY_SECONDS = 3600;

function sameSrc(rule: AclRule, tag: string): boolean {
  return rule.src.length === 1 && rule.src[0] === tag;
}

export class HeadscaleHttpApi implements TailscaleApi {
  constructor(
    private readonly config: HeadscaleConfig,
    private readonly fetchFn: FetchLike = globalThis.fetch,
    /** Injectable clock for computing key expiry timestamps (testability). */
    private readonly now: () => number = () => Date.now(),
  ) {}

  async mintAuthKey(opts: MintAuthKeyOptions): Promise<MintedAuthKey> {
    const expirySeconds = opts.expirySeconds ?? DEFAULT_KEY_EXPIRY_SECONDS;
    const json = await this.request("POST", "/api/v1/preauthkey", {
      user: await this.userId(),
      reusable: false,
      ephemeral: opts.ephemeral ?? false,
      aclTags: [opts.tag],
      expiration: new Date(this.now() + expirySeconds * 1000).toISOString(),
    });
    const key = (json as { preAuthKey: HsPreAuthKey }).preAuthKey;
    return {
      key: key.key,
      keyId: key.id,
      tag: opts.tag,
      expiresAt: key.expiration,
    };
  }

  /** Headscale expires by key STRING: list the user's keys, match ours by id.
   * An id no longer listed means already expired/consumed — success. */
  async revokeAuthKey(keyId: string): Promise<void> {
    const userId = await this.userId();
    const json = await this.request(
      "GET",
      `/api/v1/preauthkey?user=${encodeURIComponent(userId)}`,
    );
    const keys = (json as { preAuthKeys?: HsPreAuthKey[] }).preAuthKeys ?? [];
    const match = keys.find((k) => k.id === keyId);
    if (!match) return;
    await this.request("POST", "/api/v1/preauthkey/expire", {
      user: userId,
      key: match.key,
    });
  }

  async nodesByTag(tag: string): Promise<TailnetNode[]> {
    return (await this.listNodes())
      .filter((n) => this.tagsOf(n).includes(tag))
      .map((n) => ({
        nodeId: n.id,
        hostname: n.givenName,
        tags: this.tagsOf(n),
        online: n.online ?? false,
      }));
  }

  async isNodeOnline(tag: string): Promise<boolean> {
    return (await this.nodesByTag(tag)).some((n) => n.online);
  }

  /** Invite enrollment isn't used on the headscale (test-tier) backend. */
  hasJoined(_email: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  async nodeIpv4(hostname: string): Promise<string | null> {
    const node = (await this.listNodes()).find((n) => n.givenName === hostname);
    return (node?.ipAddresses ?? []).find((a) => a.startsWith("100.")) ?? null;
  }

  /** Headscale has no FQDN field on nodes, so compose it from the node's
   * givenName and the configured base domain. Null if the node isn't enrolled. */
  async nodeFqdn(hostname: string): Promise<string | null> {
    const node = (await this.listNodes()).find((n) => n.givenName === hostname);
    return node ? `${node.givenName}.${this.config.baseDomain}` : null;
  }

  async deleteNode(nodeId: string): Promise<void> {
    await this.request("DELETE", `/api/v1/node/${nodeId}`);
  }

  /** Grant `src` (tag or user email) access to ONLY its endpoint via a classic
   * acls rule; own the tag when `src` is one. Idempotent; a stale same-src rule
   * is replaced, never accumulated. */
  async ensureFriendAcl(src: string, endpointHostPort: string): Promise<void> {
    const ownsTag = src.startsWith("tag:");
    const { host, port } = splitHostPort(endpointHostPort);
    const desired: AclRule = {
      action: "accept",
      src: [src],
      dst: [`${host}:${port}`],
    };
    await this.updatePolicy((policy) => {
      const acls = policy.acls ?? [];
      const hasRule = acls.some((r) =>
        sameSrc(r, src) && JSON.stringify(r) === JSON.stringify(desired)
      );
      const hasOwner = !ownsTag || Boolean(policy.tagOwners?.[src]);
      if (hasRule && hasOwner) return null; // already in place
      const tagOwners = { ...policy.tagOwners };
      if (ownsTag) {
        tagOwners[src] = policy.tagOwners?.[src] ?? [this.tagOwner()];
      }
      return {
        ...policy,
        tagOwners,
        acls: hasRule
          ? acls
          : [...acls.filter((r) => !sameSrc(r, src)), desired],
      };
    });
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

  /** Drop the friend's rule (and tag ownership, if a tag). Idempotent. */
  async removeFriendAcl(src: string): Promise<void> {
    await this.updatePolicy((policy) => {
      const acls = (policy.acls ?? []).filter((r) => !sameSrc(r, src));
      const tagOwners = { ...policy.tagOwners };
      if (src.startsWith("tag:")) delete tagOwners[src];
      return { ...policy, acls, tagOwners };
    });
  }

  /** Headscale mints no HTTPS certs, so serve runs HTTP-only and MagicDNS cert
   * provisioning is moot — report false (the preflight only gates on this when
   * serveMode is https, which headscale never uses). */
  magicDnsEnabled(): Promise<boolean> {
    return Promise.resolve(false);
  }

  /** Headscale mints no HTTPS certs — serve runs HTTP-only against it. */
  httpsCertsEnabled(): Promise<boolean> {
    return Promise.resolve(false);
  }

  /** Whether `tag` is declared in the policy's tagOwners — read-only. */
  async isTagOwned(tag: string): Promise<boolean> {
    // A never-written policy GETs a 500 "acl policy not found" → treat as empty.
    const json = await this.request("GET", "/api/v1/policy").catch((err) => {
      if (err instanceof Error && /acl policy not found/.test(err.message)) {
        return { policy: "" };
      }
      throw err;
    });
    const raw = (json as { policy?: string }).policy ?? "";
    const policy = raw === "" ? {} : JSON.parse(raw) as AclPolicy;
    return Boolean(policy.tagOwners?.[tag]);
  }

  // ---- helpers ----

  private tagOwner(): string {
    return this.config.tagOwner ?? `${this.config.user}@`;
  }

  /** The preauthkey endpoints take the NUMERIC user id (uint64), not the
   * name — resolve it from the user list on every call (homelab-scale). */
  private async userId(): Promise<string> {
    const json = await this.request("GET", "/api/v1/user");
    const users = (json as { users?: { id: string; name: string }[] })
      .users ?? [];
    const match = users.find((u) => u.name === this.config.user);
    if (!match) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `headscale user "${this.config.user}" not found — create it first ` +
          `(headscale users create ${this.config.user})`,
      );
    }
    return match.id;
  }

  private async listNodes(): Promise<HsNode[]> {
    const json = await this.request("GET", "/api/v1/node");
    return (json as { nodes?: HsNode[] }).nodes ?? [];
  }

  private tagsOf(node: HsNode): string[] {
    // A tag can appear in more than one field — dedupe across all of them.
    return [
      ...new Set([
        ...(node.tags ?? []),
        ...(node.forcedTags ?? []),
        ...(node.validTags ?? []),
      ]),
    ];
  }

  /** Read-modify-write on the policy. The policy rides as a JSON string inside
   * the response/request envelope; empty string = no policy yet. No ETag/CAS —
   * headscale has none; the manager is the only writer in this deployment. */
  private async updatePolicy(
    mutate: (policy: AclPolicy) => AclPolicy | null,
  ): Promise<void> {
    // A never-written policy GETs a 500 "acl policy not found" (database
    // mode) — that's "empty", not an error; the first friend creates it.
    const json = await this.request("GET", "/api/v1/policy").catch((err) => {
      if (err instanceof Error && /acl policy not found/.test(err.message)) {
        return { policy: "" };
      }
      throw err;
    });
    const raw = (json as { policy?: string }).policy ?? "";
    const policy = raw === "" ? {} : JSON.parse(raw) as AclPolicy;
    const next = mutate(policy);
    if (next === null) return;
    await this.request("PUT", "/api/v1/policy", {
      policy: JSON.stringify(next),
    });
  }

  /** Authenticated request; throws ServiceError on non-2xx. Returns parsed JSON. */
  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const res = await this.fetchFn(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ServiceError(
        res.status === 403 ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
        `headscale ${method} ${path} failed (${res.status}): ${text}`,
      );
    }
    if (res.status === 204) return undefined;
    return await res.json().catch(() => undefined);
  }
}
