import type { TailnetUser, UserInvite, UserInviteApi } from "./userInvite.ts";
import { ServiceError } from "../lib/ServiceError.ts";

// The token is a PERSONAL API token used verbatim as the Bearer credential;
// there is no OAuth exchange because the invite endpoint rejects OAuth keys.

const DEFAULT_BASE = "https://api.tailscale.com/api/v2";
/** Invites always use the least-privilege member role, never an admin role. */
const INVITE_ROLE = "member";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface UserInviteConfig {
  /** A personal API access token (`tskey-api-…`), user-owned and never
   * persisted. */
  token?: string;
  baseUrl?: string;
}

interface ApiInvite {
  id: string;
  email?: string;
  inviteUrl: string;
  lastEmailSentAt?: string;
}

interface ApiUser {
  id: string;
  loginName: string;
  role?: string;
}

export class TailscaleUserInviteApi implements UserInviteApi {
  private readonly base: string;

  constructor(
    private readonly config: UserInviteConfig,
    private readonly fetchFn: FetchLike = globalThis.fetch,
  ) {
    this.base = config.baseUrl ?? DEFAULT_BASE;
  }

  get configured(): boolean {
    return Boolean(this.config.token);
  }

  async createUserInvite(email: string): Promise<UserInvite> {
    // The body is a LIST even for one invite; a single object is rejected with
    // "expected a list of invitation requests".
    const json = await this.request("POST", `/tailnet/-/user-invites`, [
      { role: INVITE_ROLE, email },
    ]);
    const first = (Array.isArray(json) ? json[0] : json) as ApiInvite;
    return this.toInvite(first, email);
  }

  async getUserInvite(id: string): Promise<UserInvite | null> {
    try {
      // Get/resend/delete are root-scoped with NO /tailnet segment, unlike create.
      const raw = await this.request("GET", `/user-invites/${id}`) as ApiInvite;
      return this.toInvite(raw, raw.email ?? "");
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
  }

  async resendUserInvite(id: string): Promise<void> {
    try {
      await this.request("POST", `/user-invites/${id}/resend`);
    } catch (err) {
      if (err instanceof ServiceError && /\(429\)/.test(err.message)) {
        throw new ServiceError(
          "TOO_MANY_REQUESTS",
          "Tailscale limits invite resends to one per minute — try again shortly.",
        );
      }
      throw err;
    }
  }

  async deleteUserInvite(id: string): Promise<void> {
    try {
      await this.request("DELETE", `/user-invites/${id}`);
    } catch (err) {
      if (this.isNotFound(err)) return; // already gone counts as success
      throw err;
    }
  }

  async findUserByEmail(email: string): Promise<TailnetUser | null> {
    const json = await this.request("GET", `/tailnet/-/users`) as {
      users?: ApiUser[];
    };
    const users = json.users ?? [];
    const want = email.toLowerCase();
    const hit = users.find((u) => u.loginName.toLowerCase() === want);
    return hit
      ? { id: hit.id, loginName: hit.loginName, role: hit.role ?? "" }
      : null;
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.request("POST", `/user/${userId}/delete`);
    } catch (err) {
      if (this.isNotFound(err)) return; // already gone counts as success
      throw err;
    }
  }

  // ---- helpers ----

  private toInvite(raw: ApiInvite, email: string): UserInvite {
    return {
      id: raw.id,
      email: raw.email ?? email,
      inviteUrl: raw.inviteUrl,
      lastEmailSentAt: raw.lastEmailSentAt ?? null,
    };
  }

  private isNotFound(err: unknown): boolean {
    return err instanceof ServiceError && /\(404\)/.test(err.message);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    if (!this.config.token) {
      throw new ServiceError(
        "PRECONDITION_FAILED",
        "user-invite API is not configured (no personal API token)",
      );
    }
    const res = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ServiceError(
        res.status === 403 ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
        `tailscale ${method} ${path} failed (${res.status}): ${text}`,
      );
    }
    if (res.status === 204) return undefined;
    return await res.json().catch(() => undefined);
  }
}
