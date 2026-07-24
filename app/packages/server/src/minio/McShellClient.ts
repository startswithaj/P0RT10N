import type {
  DuResult,
  McClient,
  McClientFactory,
  McTarget,
  S3Credential,
  TraceEvent,
  UserEntry,
} from "./mc.ts";
import type { CommandRunner, TempFiles } from "../lib/CommandRunner.ts";
import type { LockMode } from "@p0rt1on/shared/domain";
import { NotImplementedError, ServiceError } from "../lib/ServiceError.ts";
import { maskSecrets, safeArgs } from "../lib/redact.ts";

// Real McClient: shells out to `mc` for one instance. Root creds ride a
// per-call `MC_HOST_<alias>` env var (invisible in host `ps`, no `~/.mc`
// state), factory-derived from the master key — nothing here persisted.
// Arg-building + parsing unit-tested with a fake runner; real `mc` behaviour
// verified by the integration suite.

/** Least-privilege IAM policy: bucket-scoped CRUD, deny lock bypass. */
function bucketScopedPolicy(bucket: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:DeleteObject",
          "s3:GetBucketLocation",
          // Object Lock: let the client detect lock support + set/read retention
          // on the immutable objects it writes (Kopia needs these).
          "s3:GetBucketObjectLockConfiguration",
          "s3:GetBucketVersioning",
          "s3:PutObjectRetention",
          "s3:GetObjectRetention",
        ],
        Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
      },
      {
        // Retention can be extended but never shortened/removed: bypass is denied.
        Effect: "Deny",
        Action: ["s3:BypassGovernanceRetention"],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
}

/**
 * Compose the `MC_HOST_<alias>` env var that makes an mc call self-contained:
 * creds ride the child env (not visible in `ps`) instead of argv or `~/.mc`
 * alias state. User/secret are URL-encoded — they can contain URL-significant
 * chars.
 */
export function mcHostEnv(
  alias: string,
  endpoint: string,
  cred: S3Credential,
): Record<string, string> {
  const url = endpoint.replace(
    "://",
    `://${encodeURIComponent(cred.accessKeyId)}:${
      encodeURIComponent(cred.secretKey)
    }@`,
  );
  return { [`MC_HOST_${alias}`]: url };
}

/** Parse the last JSON line of `mc du --json`. */
function parseDu(stdout: string): DuResult {
  const lines = stdout.trim().split("\n").filter((l) => l.length > 0);
  const last = lines[lines.length - 1] ?? "{}";
  const parsed = JSON.parse(last) as { size?: number; objects?: number };
  return {
    bytesUsed: Number(parsed.size ?? 0),
    objectCount: Number(parsed.objects ?? 0),
  };
}

export class McShellClient implements McClient {
  constructor(
    readonly target: McTarget,
    private readonly rootCred: S3Credential,
    private readonly endpoint: string,
    private readonly runner: CommandRunner,
    private readonly tempFiles: TempFiles,
    private readonly mcBin = "mc",
    /** Delay between `mc ready` retries; injectable so tests can cover the
     * exhaustion path without real 500ms sleeps. */
    private readonly readyDelayMs = 500,
  ) {}

  /** `<alias>/<bucket>`. */
  private path(bucket: string): string {
    return `${this.target.alias}/${bucket}`;
  }

  private hostEnv(): Record<string, string> {
    return mcHostEnv(this.target.alias, this.endpoint, this.rootCred);
  }

  /**
   * Run an mc subcommand; throw on non-zero exit with the captured stderr.
   * `redact` values are masked out of the error message (argv echo AND mc's
   * own output can both contain them) — the root cred (raw and URL-encoded,
   * since mc may echo the composed MC_HOST URL) is always on the list — and
   * argv after `--` is structurally omitted (see lib/redact.ts), so secrets
   * never reach logs/UI.
   */
  private async exec(args: string[], redact: string[] = []): Promise<string> {
    const res = await this.runner.run(this.mcBin, args, this.hostEnv());
    if (res.code !== 0) {
      const raw = `mc ${safeArgs(args)} failed (${res.code}): ${
        res.stderr.trim() || res.stdout.trim()
      }`;
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        maskSecrets(raw, [
          ...redact,
          this.rootCred.secretKey,
          encodeURIComponent(this.rootCred.secretKey),
        ]),
      );
    }
    return res.stdout;
  }

  makeBucketWithLock(bucket: string): Promise<void> {
    return this.exec(["mb", "--with-lock", this.path(bucket)]).then(() => {});
  }

  /**
   * Run a removal, treating "already absent" as success (teardown idempotency
   * house rule). `absent` matches errors meaning the resource is gone — or
   * could never exist (e.g. a bucket name below MinIO's 3-char minimum).
   */
  private async execRemove(args: string[], absent: RegExp): Promise<void> {
    try {
      await this.exec(args);
    } catch (err) {
      if (err instanceof ServiceError && absent.test(err.message)) return;
      throw err;
    }
  }

  async removeBucket(bucket: string): Promise<void> {
    const absent = /does not exist|bucket name cannot be|invalid bucket name/i;
    // Two steps because `rb --force` cannot delete versions still under
    // GOVERNANCE retention (it sends no bypass header) — and every active
    // friend has in-retention data; that's the product. `rm --bypass` uses
    // the root alias's BypassGovernanceRetention right (friend creds are
    // explicitly denied it). COMPLIANCE-locked versions still — correctly —
    // fail here: nothing can delete those until retention lapses.
    await this.execRemove(
      [
        "rm",
        "--recursive",
        "--versions",
        "--force",
        "--bypass",
        this.path(bucket),
      ],
      absent,
    );
    await this.execRemove(["rb", "--force", this.path(bucket)], absent);
  }

  setDefaultRetention(
    bucket: string,
    mode: LockMode,
    days: number,
  ): Promise<void> {
    return this.exec([
      "retention",
      "set",
      "--default",
      mode,
      `${days}d`,
      this.path(bucket),
    ]).then(() => {});
  }

  setHardQuota(bucket: string, bytes: number): Promise<void> {
    // `mc admin bucket quota` is deprecated; the current command is `mc quota
    // set <alias>/<bucket> --size <bytes>` (hard quota is the only mode now).
    return this.exec([
      "quota",
      "set",
      this.path(bucket),
      "--size",
      String(bytes),
    ]).then(() => {});
  }

  async du(bucket: string): Promise<DuResult> {
    return parseDu(await this.exec(["du", "--json", this.path(bucket)]));
  }

  createUser(cred: S3Credential): Promise<void> {
    // `--` terminates flag parsing: a secret starting with `-` would otherwise
    // be read as an (undefined) flag.
    return this.exec([
      "admin",
      "user",
      "add",
      "--",
      this.target.alias,
      cred.accessKeyId,
      cred.secretKey,
    ], [cred.secretKey]).then(() => {});
  }

  async putBucketScopedPolicy(
    policyName: string,
    bucket: string,
  ): Promise<void> {
    const file = await this.tempFiles.write(bucketScopedPolicy(bucket));
    try {
      await this.exec([
        "admin",
        "policy",
        "create",
        this.target.alias,
        policyName,
        file,
      ]);
    } finally {
      await this.tempFiles.remove(file);
    }
  }

  attachPolicy(accessKeyId: string, policyName: string): Promise<void> {
    return this.exec([
      "admin",
      "policy",
      "attach",
      this.target.alias,
      policyName,
      "--user",
      accessKeyId,
    ]).then(() => {});
  }

  removePolicy(policyName: string): Promise<void> {
    return this.execRemove(
      ["admin", "policy", "rm", this.target.alias, policyName],
      /does not exist/i,
    );
  }

  disableUser(accessKeyId: string): Promise<void> {
    return this.exec([
      "admin",
      "user",
      "disable",
      this.target.alias,
      accessKeyId,
    ])
      .then(() => {});
  }

  enableUser(accessKeyId: string): Promise<void> {
    return this.exec([
      "admin",
      "user",
      "enable",
      this.target.alias,
      accessKeyId,
    ])
      .then(() => {});
  }

  removeUser(accessKeyId: string): Promise<void> {
    return this.execRemove(
      ["admin", "user", "remove", this.target.alias, accessKeyId],
      /does not exist/i,
    );
  }

  async listUsers(): Promise<UserEntry[]> {
    // One JSON object per line; `policyName` is comma-separated when a user
    // has several policies attached, and absent when it has none.
    const out = await this.exec([
      "admin",
      "user",
      "list",
      "--json",
      this.target.alias,
    ]).catch((err) => {
      // A never-configured alias has no users. Teardown of a friend whose
      // instance never came up must converge, not wedge on the listing.
      if (err instanceof ServiceError && /does not exist/i.test(err.message)) {
        return "";
      }
      throw err;
    });
    return out
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) =>
        JSON.parse(line) as { accessKey?: string; policyName?: string }
      )
      .filter((p) => typeof p.accessKey === "string" && p.accessKey.length > 0)
      .map((p) => ({
        accessKeyId: p.accessKey as string,
        policies: (p.policyName ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      }));
  }

  async setAuditWebhook(endpoint: string, authToken: string): Promise<void> {
    await this.exec([
      "admin",
      "config",
      "set",
      this.target.alias,
      "audit_webhook:p0rt1on",
      `endpoint=${endpoint}`,
      // MinIO sends auth_token as the Authorization header VERBATIM, and the
      // manager's /internal/minio-events expects the Bearer scheme — so the prefix
      // must be baked in here. Quoted because mc's KV parser splits on the
      // embedded space otherwise.
      `auth_token="Bearer ${authToken}"`,
    ], [authToken]);
    // `--json` avoids mc's interactive restart UI (needs a TTY we don't have).
    await this.exec([
      "admin",
      "service",
      "restart",
      "--json",
      this.target.alias,
    ]);
    // The restart drops connections for a moment. "Webhook configured" must
    // mean "serving again" — the very next mc call (rotate, offboard, the
    // admin clicking around right after an add) lands in that window
    // otherwise. Bounded wait, ~15s worst case.
    await this.awaitReady(30);
  }

  /** Poll `mc ready` (readyDelayMs apart) until MinIO answers; bounded. */
  private async awaitReady(attemptsLeft: number): Promise<void> {
    const res = await this.runner.run(
      this.mcBin,
      ["ready", this.target.alias],
      this.hostEnv(),
    );
    if (res.code === 0) return;
    if (attemptsLeft <= 0) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `minio ${this.target.alias} did not come back after restart`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, this.readyDelayMs));
    return this.awaitReady(attemptsLeft - 1);
  }

  // TODO: implement the live tail (streaming trace).
  trace(_signal: AbortSignal): AsyncIterable<TraceEvent> {
    return {
      [Symbol.asyncIterator]() {
        throw new NotImplementedError("McShellClient.trace not implemented");
      },
    };
  }
}

/** Derives an instance's root credential (master-key HMAC, never stored). */
export interface RootCredSource {
  rootCredentialFor(instanceHost: string): S3Credential;
}

/**
 * Builds an McShellClient per instance, sharing one runner + temp-file impl.
 * Owns admin-plane endpoint composition (via the injected addressing-mode
 * composer) and root-cred derivation, so callers pass only
 * `{ alias, minioPort }`.
 */
export class McShellClientFactory implements McClientFactory {
  constructor(
    private readonly runner: CommandRunner,
    private readonly tempFiles: TempFiles,
    private readonly keyGen: RootCredSource,
    private readonly endpointFor: (target: McTarget) => string,
    private readonly mcBin = "mc",
  ) {}

  forInstance(target: McTarget): McClient {
    return new McShellClient(
      target,
      this.keyGen.rootCredentialFor(target.alias),
      this.endpointFor(target),
      this.runner,
      this.tempFiles,
      this.mcBin,
    );
  }
}
