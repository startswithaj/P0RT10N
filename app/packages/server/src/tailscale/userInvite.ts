// User-invite onboarding — the OPTIONAL half of friend enrollment. Needs a
// USER-OWNED personal API token (OAuth clients are tailnet-owned and Tailscale
// refuses invite creation for them: "operation only permitted for user-owned
// keys"). Separate interface + credential, injected only when the token is
// configured; absent → manual console-instruction fallback.

/** A tailnet user-invite (subset we act on). `inviteUrl` is not a secret. */
export interface UserInvite {
  id: string;
  email: string;
  inviteUrl: string;
  lastEmailSentAt: string | null;
}

/** A tailnet user (subset). `role` gates offboard deletion. */
export interface TailnetUser {
  id: string;
  loginName: string;
  role: string;
}

/**
 * Tailscale user-management operations that require a user-owned token. Every
 * method throws a ServiceError on failure; deletes tolerate 404.
 */
export interface UserInviteApi {
  readonly configured: boolean;
  createUserInvite(email: string): Promise<UserInvite>;
  /** Null once the invite is gone (accepted / expired / revoked all read alike). */
  getUserInvite(id: string): Promise<UserInvite | null>;
  /** Rate-limited 1/min — surfaced as TOO_MANY_REQUESTS. */
  resendUserInvite(id: string): Promise<void>;
  deleteUserInvite(id: string): Promise<void>;
  findUserByEmail(email: string): Promise<TailnetUser | null>;
  /** Callers MUST guard: never a non-member, never when another portion shares
   * the email. */
  deleteUser(userId: string): Promise<void>;
}
