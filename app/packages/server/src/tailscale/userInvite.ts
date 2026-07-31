// Needs a USER-OWNED personal API token: Tailscale refuses invite creation for
// tailnet-owned OAuth clients. Without a token, the flow falls back to manual
// instructions.

/** `inviteUrl` is not a secret. */
export interface UserInvite {
  id: string;
  email: string;
  inviteUrl: string;
  lastEmailSentAt: string | null;
}

/** `role` gates whether offboard may delete the user. */
export interface TailnetUser {
  id: string;
  loginName: string;
  role: string;
}

/** The delete methods tolerate a 404. */
export interface UserInviteApi {
  readonly configured: boolean;
  createUserInvite(email: string): Promise<UserInvite>;
  /** Returns null once the invite is gone; accepted, expired, and revoked all
   * read alike. */
  getUserInvite(id: string): Promise<UserInvite | null>;
  /** Rate-limited to one per minute, surfaced as TOO_MANY_REQUESTS. */
  resendUserInvite(id: string): Promise<void>;
  deleteUserInvite(id: string): Promise<void>;
  findUserByEmail(email: string): Promise<TailnetUser | null>;
  /** Callers MUST guard this: never delete a non-member, and never delete while
   * another portion shares the email. */
  deleteUser(userId: string): Promise<void>;
}
