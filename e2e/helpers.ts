// Shared plumbing for the integration suites — the pieces every tier used to
// reinvent. No app runtime logic here.
import { retry } from "@std/async";
import type { FriendBundle } from "@p0rt1on/shared/domain";

// The once-shown provisioning bundle as a friend receives it.
export type ClaimedBundle = Pick<
  FriendBundle,
  "bucket" | "s3Endpoint" | "s3AccessKeyId" | "s3SecretKey" | "tsAuthKey"
>;

export const DEFAULT_MANAGER_IMAGE = "p0rt1on-manager:integrationtest";
export const DEFAULT_INSTANCE_IMAGE = "p0rt1on-instance:integrationtest";
export const DEFAULT_CLIENT_IMAGE = "p0rt1on-backup-client:integrationtest";
export const DEFAULT_HEADSCALE_URL = "http://headscale.p0rt1on.svc:8080";

// True when `bin` is runnable (on PATH) — `mc` in the manager container,
// `docker` on the host. Requires --allow-run.
function hasBinary(bin: string): boolean {
  try {
    return new Deno.Command(bin, {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).outputSync().code === 0;
  } catch {
    return false; // not installed / not on PATH
  }
}

// FAIL (never skip) when required env/binaries are absent — running a suite
// IS the opt-in.
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

// Bounded poll over @std/async retry: resolves with fn's first non-null
// value; throws on timeout WITH the last error (a swallowed cause makes
// timeouts undebuggable).
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

// The bundle → backup-client env contract (one place, matching
// backup-client/entrypoint.sh).
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

// Seed $PAYLOAD as a canary, then hand off to the real entrypoint — the
// container's exit status is Kopia's.
export const SEED_THEN_BACKUP =
  'mkdir -p /backup && printf %s "$PAYLOAD" > /backup/canary.txt && ' +
  "exec /entrypoint.sh";
