// Tailscale API wrapper — the manager owns friend enrollment: mint a
// pre-authorized, single-use, pre-tagged auth key; revoke node + key on
// offboard; keep ACLs scoping each friend's tag to only its endpoint. Access
// token via env/mounted secret, never persisted. Friends get a tagged node,
// not a user seat.

/** A minted auth key. `key` is the secret, returned ONCE for the friend bundle. */
export interface MintedAuthKey {
  /** The `tskey-auth-…` secret. Never persisted; goes straight into the bundle. */
  key: string;
  /** Stable key id (safe to log / store) for later revocation. */
  keyId: string;
  /** The tag baked into the key, e.g. `tag:p0rt1on-friend-alice`. */
  tag: string;
  /** ISO expiry of the key's redemption window (not the node's lifetime). */
  expiresAt: string;
}

/** Options for minting a friend's enrollment key. */
export interface MintAuthKeyOptions {
  /** Tag to pre-authorize on the enrolled node, e.g. `tag:p0rt1on-friend-alice`. */
  tag: string;
  /** Seconds the unused key stays redeemable. Single-use regardless. */
  expirySeconds?: number;
  /**
   * Ephemeral nodes auto-remove when they go offline. Default false — backup
   * targets are long-lived and we revoke explicitly on offboard.
   */
  ephemeral?: boolean;
}

/** A node currently on the tailnet (subset we act on). */
export interface TailnetNode {
  nodeId: string;
  hostname: string;
  tags: string[];
  online: boolean;
}

/**
 * Tailscale control-plane operations. Implementations call the Tailscale REST
 * API with the configured access token; methods throw a ServiceError on failure.
 */
export interface TailscaleApi {
  /**
   * Mint a **pre-authorized, single-use, pre-tagged** auth key. The friend
   * redeems it with `tailscale up --authkey=…`; the node enrolls tagged, not as
   * a user. Returns the secret once.
   */
  mintAuthKey(opts: MintAuthKeyOptions): Promise<MintedAuthKey>;

  /** Revoke an auth key by id (defence-in-depth on offboard / failed provision). */
  revokeAuthKey(keyId: string): Promise<void>;

  /** Nodes carrying a given tag — used to find a friend's node for revocation. */
  nodesByTag(tag: string): Promise<TailnetNode[]>;

  /** Online state of a friend's node, for the detail screen's "● online" dot. */
  isNodeOnline(tag: string): Promise<boolean>;

  /**
   * Whether a user with this login email has joined the tailnet — the
   * acceptance check for invite enrollment, readable WITHOUT the personal
   * token. Prefers the users list (needs a `users:read` scope); if that scope
   * is absent, falls back to scanning devices for one owned by the email
   * (user-owned devices carry their owner's login). Returns false when neither
   * finds them.
   */
  hasJoined(email: string): Promise<boolean>;

  /**
   * The tailnet IPv4 (100.x) of a node by hostname, or null if it hasn't shown
   * up yet. Used as the ACL grant `dst`: Tailscale rejects a MagicDNS FQDN
   * there, so per-friend scoping targets the instance's IP.
   */
  nodeIpv4(hostname: string): Promise<string | null>;

  /**
   * The node's full MagicDNS FQDN (e.g. `p0rt1on-alice.mouse-stairs.ts.net`) by
   * hostname, or null if it hasn't enrolled. This IS the friend's serve URL host
   * — read live from the node rather than composed, so it reflects any hostname
   * Tailscale actually assigned (e.g. a `-1` collision suffix). On Tailscale it's
   * the device `name`; headscale has no FQDN field, so that backend composes
   * `<hostname>.<baseDomain>`.
   */
  nodeFqdn(hostname: string): Promise<string | null>;

  /** Remove a node from the tailnet (offboard). */
  deleteNode(nodeId: string): Promise<void>;

  /**
   * Ensure the policy (ACL) grants `src` access to ONLY `endpointHostPort` and
   * nothing else — not other friends' instances, not the manager UI. `src` is a
   * friend's node tag (auth-key enrollment) or a user email (invite enrollment,
   * where the friend's own account is the grant subject and no tagOwners entry
   * applies). Idempotent; edits the tailnet policy via the API.
   */
  ensureFriendAcl(src: string, endpointHostPort: string): Promise<void>;
  removeFriendAcl(src: string): Promise<void>;

  /**
   * Ensure `tag` is declared in tagOwners (owned by the configured tagOwner),
   * writing the entry only when absent. The serve-node tag needs this: unlike a
   * friend tag it never appears as an ACL src, so ensureFriendAcl never declares
   * it, yet Tailscale rejects minting its auth key until it's owned.
   */
  ensureTagOwner(tag: string): Promise<void>;

  /**
   * MagicDNS enablement (GET /dns/preferences → `magicDNS`). A prerequisite for
   * HTTPS certs. Needs the `dns:read` scope. Headscale mints no certs → false.
   */
  magicDnsEnabled(): Promise<boolean>;

  /**
   * HTTPS-certificate enablement (GET /tailnet/-/settings → `httpsEnabled`).
   * This is the DEFINITIVE signal for whether `tailscale serve --https` works.
   * Needs the `networking_settings:read` scope. Headscale mints no certs → false.
   */
  httpsCertsEnabled(): Promise<boolean>;

  /** Whether `tag` is already declared in tagOwners — read-only (no policy
   * write). Lets a preflight report the serve tag's state without mutating. */
  isTagOwned(tag: string): Promise<boolean>;
}
