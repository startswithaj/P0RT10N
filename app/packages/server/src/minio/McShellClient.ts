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

// ============================================================================
// Real McClient: shells out to `mc` for one instance (by alias). Root creds are
// configured out-of-band via `mc alias set` at instance startup, so this layer
// holds no secret. Arg-building + parsing are unit-tested with a fake runner;
// the actual `mc` behaviour is verified by the integration suite against a real
// MinIO container.
// ============================================================================

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
    private readonly runner: CommandRunner,
    private readonly tempFiles: TempFiles,
    private readonly mcBin = "mc",
  ) {}

  /** `<alias>/<bucket>`. */
  private path(bucket: string): string {
    return `${this.target.alias}/${bucket}`;
  }

  /**
   * Run an mc subcommand; throw on non-zero exit with the captured stderr.
   * `redact` values are masked out of the error message (argv echo AND mc's
   * own output can both contain them), and argv after `--` is structurally
   * omitted (see lib/redact.ts) — secrets never reach logs/UI.
   */
  private async exec(args: string[], redact: string[] = []): Promise<string> {
    const res = await this.runner.run(this.mcBin, args);
    if (res.code !== 0) {
      const raw = `mc ${safeArgs(args)} failed (${res.code}): ${
        res.stderr.trim() || res.stdout.trim()
      }`;
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        maskSecrets(raw, redact),
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
      // manager's /internal/audit expects the Bearer scheme — so the prefix
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
  }

  /** Live tail — streaming; implemented in the integration phase. */
  trace(_signal: AbortSignal): AsyncIterable<TraceEvent> {
    return {
      [Symbol.asyncIterator]() {
        throw new NotImplementedError("McShellClient.trace not implemented");
      },
    };
  }
}

/** Builds an McShellClient per instance, sharing one runner + temp-file impl. */
export class McShellClientFactory implements McClientFactory {
  constructor(
    private readonly runner: CommandRunner,
    private readonly tempFiles: TempFiles,
    private readonly mcBin = "mc",
  ) {}

  forInstance(target: McTarget): McClient {
    return new McShellClient(target, this.runner, this.tempFiles, this.mcBin);
  }

  async setAlias(
    alias: string,
    endpoint: string,
    cred: S3Credential,
  ): Promise<void> {
    // Root creds are on argv here (loopback/docker-network admin plane only).
    // `--` terminates flag parsing so a secret starting with `-` isn't read as a flag.
    const res = await this.runner.run(this.mcBin, [
      "alias",
      "set",
      "--",
      alias,
      endpoint,
      cred.accessKeyId,
      cred.secretKey,
    ]);
    if (res.code !== 0) {
      // The message already omits argv; masking covers mc echoing the secret
      // in its own stderr, and documents the declaration for future refactors.
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        maskSecrets(
          `mc alias set ${alias} failed (${res.code}): ${
            res.stderr.trim() || res.stdout.trim()
          }`,
          [cred.secretKey],
        ),
      );
    }
  }
}
