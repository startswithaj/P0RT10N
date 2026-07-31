// Tailscale control-plane wrapper; key secrets exist only in request scope.

/** `key` is the secret, returned ONCE for the friend bundle. */
export interface MintedAuthKey {
  key: string;
  /** This id is safe to log and store, and is used to revoke the key later. */
  keyId: string;
  tag: string;
  /** This is the expiry of the key's redemption window, not of the node's lifetime. */
  expiresAt: string;
}

export interface MintAuthKeyOptions {
  tag: string;
  /** How long the unused key stays redeemable, in seconds; the key is single-use regardless. */
  expirySeconds?: number;
  /** Defaults to false because backup targets are long-lived and are revoked explicitly on offboard. */
  ephemeral?: boolean;
}

export interface TailnetNode {
  nodeId: string;
  hostname: string;
  tags: string[];
  online: boolean;
}

export interface TailscaleApi {
  /** Mints a pre-authorized, single-use, pre-tagged key, so the node enrolls
   * tagged rather than as a user. The secret is returned only once. */
  mintAuthKey(opts: MintAuthKeyOptions): Promise<MintedAuthKey>;

  revokeAuthKey(keyId: string): Promise<void>;

  nodesByTag(tag: string): Promise<TailnetNode[]>;

  isNodeOnline(tag: string): Promise<boolean>;

  /** Prefers the users list (needs the `users:read` scope); when that scope is
   * absent, falls back to scanning devices for one owned by the email. */
  hasJoined(email: string): Promise<boolean>;

  /** Used as the ACL grant `dst`: Tailscale rejects a MagicDNS FQDN there, so
   * per-friend scoping targets the node's IP. Returns null until the node shows up. */
  nodeIpv4(hostname: string): Promise<string | null>;

  /** The serve URL host, read live because Tailscale may assign a collision
   * suffix such as `-1`. Headscale has no FQDN field, so that backend composes
   * `hostname.baseDomain`. */
  nodeFqdn(hostname: string): Promise<string | null>;

  deleteNode(nodeId: string): Promise<void>;

  /** Grants `src` (a friend tag, or a user email during invite enrollment) access
   * to ONLY `endpointHostPort`, not to other instances or the manager UI.
   * Idempotent. */
  ensureFriendAcl(src: string, endpointHostPort: string): Promise<void>;
  removeFriendAcl(src: string): Promise<void>;

  /** The serve tag needs this: it never appears as an ACL src, so ensureFriendAcl
   * never declares it, yet minting its auth key requires a tagOwners entry. */
  ensureTagOwner(tag: string): Promise<void>;

  /** Whether MagicDNS is on, a prerequisite for HTTPS certs; needs the `dns:read`
   * scope. Headscale mints no certs, so its backend reports false. */
  magicDnsEnabled(): Promise<boolean>;

  /** The definitive signal for `serve --https`; needs the
   * `networking_settings:read` scope. Headscale mints no certs, so its backend
   * reports false. */
  httpsCertsEnabled(): Promise<boolean>;

  /** Read-only check that never writes the policy. */
  isTagOwned(tag: string): Promise<boolean>;
}
