import type { SmokeTester, SmokeTestParams } from "./deps.ts";
import type { CommandRunner, TempFiles } from "../lib/CommandRunner.ts";
import { ServiceError } from "../lib/ServiceError.ts";

// ============================================================================
// SmokeTester via `mc`, exercising the FRIEND's freshly-issued key end-to-end
// (PutObject → GetObject → DeleteObject) against their bucket. Reuses the bundled
// `mc` + the CommandRunner/TempFiles seams (no S3 SDK). MUST run before default
// retention is armed, so the test object's delete isn't blocked by Object Lock.
// ============================================================================

export class McSmokeTester implements SmokeTester {
  constructor(
    private readonly runner: CommandRunner,
    private readonly tempFiles: TempFiles,
    private readonly mcBin = "mc",
  ) {}

  async run({ endpoint, bucket, cred }: SmokeTestParams): Promise<void> {
    const suffix = crypto.randomUUID().slice(0, 8);
    const alias = `p0rt1on-smoke-${suffix}`;
    const objectPath = `${alias}/${bucket}/.p0rt1on-smoke-${suffix}`;
    const token = crypto.randomUUID();
    const file = await this.tempFiles.write(token);
    try {
      // Configure a throwaway alias with the friend's own creds. `--` guards a
      // secret that starts with `-` from being parsed as a flag.
      await this.exec([
        "alias",
        "set",
        "--",
        alias,
        endpoint,
        cred.accessKeyId,
        cred.secretKey,
      ]);
      await this.exec(["cp", file, objectPath]); // PutObject
      const got = await this.exec(["cat", objectPath]); // GetObject
      if (got.trim() !== token) {
        throw new ServiceError(
          "INTERNAL_SERVER_ERROR",
          "smoke-test GET returned unexpected content",
        );
      }
      await this.exec(["rm", objectPath]); // DeleteObject
    } finally {
      await this.exec(["alias", "remove", alias]).catch(() => undefined);
      await this.tempFiles.remove(file);
    }
  }

  private async exec(args: string[]): Promise<string> {
    const res = await this.runner.run(this.mcBin, args);
    if (res.code !== 0) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `smoke-test step \`mc ${args[0]}\` failed (${res.code}): ${
          res.stderr.trim() || res.stdout.trim()
        }`,
      );
    }
    return res.stdout;
  }
}
