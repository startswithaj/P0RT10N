// The password is hashed once at boot with SHA-256 and the plaintext is never retained. Sessions
// are random opaque tokens held only in memory, so a manager restart requires re-login.

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// First 3 wrong attempts are unthrottled (covers typos); beyond that the
// lockout backs off exponentially, capped at MAX_DELAY_MS.
const FAILURE_THRESHOLD = 3;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

async function hash(value: string): Promise<string> {
  const bits = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value) as BufferSource,
  );
  return [...new Uint8Array(bits)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class AdminAuth {
  private readonly sessions = new Map<string, number>();
  // Deliberately a single global counter, not per-IP/per-username: single-admin
  // homelab scope, so throttling "the one admin" under attack is an acceptable trade-off.
  private failureCount = 0;
  private lockedUntil = 0;

  private constructor(
    private readonly creds: { username: string; passHash: string } | null,
    private readonly now: () => number,
  ) {}

  get enabled(): boolean {
    return this.creds !== null;
  }

  // Auth being off is only safe on a loopback bind; a non-loopback bind without
  // it just logs a startup warning in main.ts, it isn't blocked.
  static disabled(): AdminAuth {
    return new AdminAuth(null, Date.now);
  }

  static async create(
    creds: { username: string; password: string },
    now: () => number = () => Date.now(),
  ): Promise<AdminAuth> {
    const passHash = await hash(creds.password);
    return new AdminAuth({ username: creds.username, passHash }, now);
  }

  // The submitted password is hashed and compared with plain equality, which is safe
  // since the underlying hash is one-way.
  async verify(username: string, password: string): Promise<boolean> {
    if (this.creds === null) return false;
    // While locked out, reject without hashing; a rejected attempt made
    // during lockout does not extend it further.
    if (this.now() < this.lockedUntil) return false;
    const ok = (await hash(password)) === this.creds.passHash &&
      username === this.creds.username;
    if (ok) {
      this.failureCount = 0;
      this.lockedUntil = 0;
      return true;
    }
    this.failureCount++;
    if (this.failureCount > FAILURE_THRESHOLD) {
      const delay = Math.min(
        MAX_DELAY_MS,
        BASE_DELAY_MS * 2 ** (this.failureCount - FAILURE_THRESHOLD),
      );
      this.lockedUntil = this.now() + delay;
    }
    return false;
  }

  createSession(): string {
    const token = crypto.randomUUID();
    this.sessions.set(token, this.now() + SESSION_TTL_MS);
    return token;
  }

  validate(token: string): boolean {
    const expiresAt = this.sessions.get(token);
    if (expiresAt === undefined) return false;
    if (this.now() > expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  destroy(token: string): void {
    this.sessions.delete(token);
  }
}
