// Shared plumbing for the e2e suites. It imports no app code, so the
// suites exercise only the public surfaces an admin or friend can reach.
import { retry } from "@std/async";
import type { FriendBundle } from "@p0rt1on/shared/domain";

export type ClaimedBundle = Pick<
  FriendBundle,
  "bucket" | "s3Endpoint" | "s3AccessKeyId" | "s3SecretKey" | "tsAuthKey"
>;

export const DEFAULT_MANAGER_IMAGE = "p0rt1on-manager:e2e";
export const DEFAULT_INSTANCE_IMAGE = "p0rt1on-instance:e2e";
export const DEFAULT_CLIENT_IMAGE = "p0rt1on-backup-client:e2e";
export const DEFAULT_HEADSCALE_URL = "http://headscale.p0rt1on.svc:8080";

function hasBinary(bin: string): boolean {
  try {
    return new Deno.Command(bin, {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).outputSync().code === 0;
  } catch {
    return false;
  }
}

// Fails rather than skips when required env or binaries are missing,
// because running a suite is itself the opt-in.
export function requireConfig(
  opts: { env?: string[]; binaries?: string[]; hint: string },
): void {
  const missing = (opts.env ?? []).filter((k) => !Deno.env.get(k));
  const absent = (opts.binaries ?? []).filter((b) => !hasBinary(b));
  const all = [...missing, ...absent.map((b) => `\`${b}\` on PATH`)];
  if (all.length) {
    throw new Error(`not configured: ${all.join(", ")} — ${opts.hint}`);
  }
}

// Polls until fn returns a value, then throws on timeout with the last
// error attached, since a swallowed cause would make timeouts undebuggable.
export async function until<T>(
  what: string,
  fn: () => Promise<T | null | undefined>,
  attempts: number,
  intervalMs = 2000,
): Promise<T> {
  const seen = { lastError: undefined as unknown };
  try {
    return await retry(async () => {
      const got = await fn().catch((e) => {
        seen.lastError = e;
        return null;
      });
      if (got === null || got === undefined) throw new Error("not ready");
      return got;
    }, {
      maxAttempts: attempts,
      minTimeout: intervalMs,
      maxTimeout: intervalMs,
      multiplier: 1,
      jitter: 0,
    });
  } catch (_timedOut) {
    throw new Error(
      `timed out waiting for ${what}` +
        (seen.lastError === undefined
          ? ""
          : ` (last error: ${seen.lastError})`),
    );
  }
}

export function friendClientEnv(
  bundle: ClaimedBundle,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    S3_ENDPOINT: bundle.s3Endpoint,
    S3_BUCKET: bundle.bucket,
    S3_ACCESS_KEY_ID: bundle.s3AccessKeyId,
    S3_SECRET_ACCESS_KEY: bundle.s3SecretKey,
    TAILSCALE_AUTHKEY: bundle.tsAuthKey ?? "",
    KOPIA_PASSWORD: "it-kopia-pw",
    BACKUP_PATH: "/backup",
    ...extra,
  };
}

// Execs the real entrypoint after seeding the canary file, so the
// container's exit status comes from Kopia, not the shell.
export const SEED_THEN_BACKUP =
  'mkdir -p /backup && printf %s "$PAYLOAD" > /backup/canary.txt && ' +
  "exec /entrypoint.sh";

// Recomputes what entrypoint.sh's VERIFY_RESTORE step should have printed
// for a restored file, so the suites can assert the canary's content was
// actually restored — independent of whether the image's own verify/diff
// logic is correct.
export async function sha256Hex(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function trpcClient(base: string) {
  const jar = { cookie: "" };
  return async (proc: string, input?: unknown): Promise<unknown> => {
    const res = await fetch(`${base}/trpc/${proc}`, {
      method: input === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(jar.cookie ? { cookie: jar.cookie } : {}),
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) jar.cookie = setCookie.split(";")[0];
    const body = await res.json().catch(() => null) as {
      result?: { data?: unknown };
      error?: { message?: string };
    } | null;
    if (!res.ok || body?.error) {
      throw new Error(
        `trpc ${proc} failed (${res.status}): ${
          body?.error?.message ?? "<no body>"
        }`,
      );
    }
    return body?.result?.data;
  };
}

// Builds mc's documented per-alias env variable (MC_HOST_<alias>) so
// credentials travel via env, never argv.
export function mcHostEnvFor(
  alias: string,
  endpoint: string,
  accessKeyId: string,
  secretKey: string,
): Record<string, string> {
  const url = new URL(endpoint);
  url.username = accessKeyId;
  url.password = secretKey;
  return { [`MC_HOST_${alias}`]: url.toString() };
}
