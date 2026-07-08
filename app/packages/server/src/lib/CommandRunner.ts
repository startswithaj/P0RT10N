// ============================================================================
// Process + temp-file abstractions injected into shell-out wrappers (mc, docker)
// so their argument-building and output-parsing are unit-testable with fakes (no
// subprocess, no Docker). The Deno-backed impls are used in production / IT.
// ============================================================================

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  /** `env` vars are merged over the child's inherited environment. */
  run(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<CommandResult>;
}

/** Runs a real subprocess via Deno.Command. Requires --allow-run. */
export class DenoCommandRunner implements CommandRunner {
  async run(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<CommandResult> {
    const output = await new Deno.Command(command, {
      args,
      env,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    return {
      code: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  }
}

/** Writes short-lived files (e.g. an IAM policy `mc` reads from disk). */
export interface TempFiles {
  /** Write `content` to a fresh file and return its path. */
  write(content: string): Promise<string>;
  remove(path: string): Promise<void>;
}

/**
 * Temp files under a pwd-relative dir (never the system /tmp). Requires
 * --allow-read/--allow-write.
 */
export class DenoTempFiles implements TempFiles {
  constructor(private readonly dir = "./.p0rt1on-tmp") {}

  async write(content: string): Promise<string> {
    await Deno.mkdir(this.dir, { recursive: true });
    const path = `${this.dir}/${crypto.randomUUID()}.json`;
    await Deno.writeTextFile(path, content);
    return path;
  }

  async remove(path: string): Promise<void> {
    await Deno.remove(path).catch(() => {/* best-effort cleanup */});
  }
}
