// The password is hashed once at boot with SHA-256 and the plaintext is never retained. Sessions
// are random opaque tokens held only in memory, so a manager restart requires re-login.

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

  private constructor(
    private readonly creds: { username: string; passHash: string } | null,
    private readonly now: () => number,
  ) {}

  get enabled(): boolean {
    return this.creds !== null;
  }

  // Auth being off is only safe on a loopback bind, which the boot guard enforces.
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
    return (await hash(password)) === this.creds.passHash &&
      username === this.creds.username;
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
