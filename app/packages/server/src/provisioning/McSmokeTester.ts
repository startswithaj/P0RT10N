import type { SmokeTester, SmokeTestParams } from "./deps.ts";
import type { CommandRunner, TempFiles } from "../lib/CommandRunner.ts";
import { ServiceError } from "../lib/ServiceError.ts";
import { maskSecrets } from "../lib/redact.ts";
import { mcHostEnv } from "../minio/McShellClient.ts";

// This smoke test must run before default retention is armed, since Object Lock would
// otherwise block the test object's delete.

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
    // A throwaway MC_HOST env var scopes the friend's credentials to each call, so nothing secret
    // ever appears on argv where `ps` could see it, and there is no alias config to clean up.
    const env = mcHostEnv(alias, endpoint, cred);
    try {
      await this.exec(["cp", file, objectPath], env, cred.secretKey);
      const got = await this.exec(["cat", objectPath], env, cred.secretKey);
      if (got.trim() !== token) {
        throw new ServiceError(
          "INTERNAL_SERVER_ERROR",
          "smoke-test GET returned unexpected content",
        );
      }
      await this.exec(["rm", objectPath], env, cred.secretKey);
    } finally {
      await this.tempFiles.remove(file);
    }
  }

  private async exec(
    args: string[],
    env: Record<string, string>,
    secret: string,
  ): Promise<string> {
    const res = await this.runner.run(this.mcBin, args, env);
    if (res.code !== 0) {
      // mc can echo the MC_HOST URL in its own stderr, so the secret is masked in
      // both its raw and URL-encoded forms.
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        maskSecrets(
          `smoke-test step \`mc ${args[0]}\` failed (${res.code}): ${
            res.stderr.trim() || res.stdout.trim()
          }`,
          [secret, encodeURIComponent(secret)],
        ),
      );
    }
    return res.stdout;
  }
}
