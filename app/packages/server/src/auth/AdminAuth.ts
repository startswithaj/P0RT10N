// ============================================================================
// Optional single-admin auth for the admin surface. Credentials come from env
// (P0RT1ON_ADMIN_USERNAME/_PASSWORD); the password is hashed ONCE at boot (PBKDF2
// via Web Crypto — zero deps) and the plaintext is never retained. Sessions are
// random opaque tokens held in-memory (a manager restart = re-login, fine for a
// single admin). When disabled every request is allowed — the boot guard
// forbids a non-loopback bind in that case.
// ============================================================================

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** SHA-256 → hex string. */
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
  private readonly sessions = new Map<string, number>(); // token -> expiresAt

  private constructor(
    /** Null → auth off; middleware allows every request. */
    private readonly creds: { username: string; passHash: string } | null,
    private readonly now: () => number,
  ) {}

  get enabled(): boolean {
    return this.creds !== null;
  }

  /** Auth off — allows everything (safe only on a loopback bind; boot guard). */
  static disabled(): AdminAuth {
    return new AdminAuth(null, Date.now);
  }

  /** Hash the env password once; returns an enabled instance. */
  static async create(
    creds: { username: string; password: string },
    now: () => number = () => Date.now(),
  ): Promise<AdminAuth> {
    const passHash = await hash(creds.password);
    return new AdminAuth({ username: creds.username, passHash }, now);
  }

  /** Verify by hashing the submitted password and comparing to the stored one
   * (one-way hash → a plain compare is safe). */
  async verify(username: string, password: string): Promise<boolean> {
    if (this.creds === null) return false;
    return (await hash(password)) === this.creds.passHash &&
      username === this.creds.username;
  }

  createSession(): string {
    const token = crypto.randomUUID();
    this.sessions.set(token, this.now() + SESSION_TTL_MS);
    return token;
  }

  /** True if the token exists and hasn't expired (expired tokens are pruned). */
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
