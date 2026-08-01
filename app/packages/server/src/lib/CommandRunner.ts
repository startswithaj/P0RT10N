export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<CommandResult>;
}

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

export interface TempFiles {
  write(content: string): Promise<string>;
  remove(path: string): Promise<void>;
}

/** Temp files always live under a pwd-relative directory, never the system /tmp. */
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
