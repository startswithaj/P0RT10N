// ============================================================================
// Tailscale API wrapper — the manager owns friend enrollment programmatically:
// mint a pre-authorized, single-use, pre-tagged auth key; revoke the node and
// key on offboard; keep ACLs scoping each friend's tag to only its endpoint.
// The API access token is supplied via env / mounted secret, never persisted.
// Friends never get a user seat — only a tagged node (see PLAN §Connectivity).
// ============================================================================

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
   * The tailnet IPv4 (100.x) of a node by hostname, or null if it hasn't shown
   * up yet. Used as the ACL grant `dst`: Tailscale rejects a MagicDNS FQDN
   * there, so per-friend scoping targets the instance's IP.
   */
  nodeIpv4(hostname: string): Promise<string | null>;

  /** Remove a node from the tailnet (offboard). */
  deleteNode(nodeId: string): Promise<void>;

  /**
   * Ensure the policy (ACL) grants `tag` access to ONLY `endpointHostPort` and
   * nothing else — not other friends' instances, not the manager UI. Idempotent;
   * edits the tailnet policy file via the API. Removing the grant happens on
   * offboard.
   */
  ensureFriendAcl(tag: string, endpointHostPort: string): Promise<void>;
  removeFriendAcl(tag: string): Promise<void>;
}
