// Shared plumbing for the integration DRIVERS (the run.ts files) — argv-array
// spawns only, never a shell. Distinct from CommandRunner: drivers need
// inherited stdio for streaming builds/tests plus stdin piping.
import { hasBinary } from "../app/packages/server/src/lib/hasBinary.ts";

export interface RunOptions {
  env?: Record<string, string>;
  stdin?: string;
  // Default true: throw on nonzero exit.
  check?: boolean;
}

export interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

async function spawn(
  cmd: string,
  args: string[],
  opts: RunOptions,
  pipeOutput: boolean,
): Promise<Captured> {
  const child = new Deno.Command(cmd, {
    args,
    env: opts.env,
    stdin: opts.stdin === undefined ? "null" : "piped",
    stdout: pipeOutput ? "piped" : "inherit",
    stderr: pipeOutput ? "piped" : "inherit",
  }).spawn();
  if (opts.stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(opts.stdin));
    await writer.close();
  }
  const out = await child.output();
  const decoder = new TextDecoder();
  return {
    code: out.code,
    stdout: pipeOutput ? decoder.decode(out.stdout) : "",
    stderr: pipeOutput ? decoder.decode(out.stderr) : "",
  };
}

// Stream output to the terminal (builds, tests). Throws on nonzero exit.
export async function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<void> {
  const res = await spawn(cmd, args, opts, false);
  if (res.code !== 0 && opts.check !== false) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${res.code}`);
  }
}

// Capture output. Throws on nonzero exit WITH stderr — never swallowed.
export async function capture(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<Captured> {
  const res = await spawn(cmd, args, opts, true);
  if (res.code !== 0 && opts.check !== false) {
    throw new Error(
      `${cmd} ${args.join(" ")} exited ${res.code}: ` +
        (res.stderr.trim() || res.stdout.trim()),
    );
  }
  return res;
}

export function requireBinaries(
  ...bins: (string | { bin: string; probeArgs: string[] })[]
): void {
  const missing = bins
    .filter((b) =>
      typeof b === "string" ? !hasBinary(b) : !hasBinary(b.bin, b.probeArgs)
    )
    .map((b) => (typeof b === "string" ? b : b.bin));
  if (missing.length) {
    console.error(`missing required tools: ${missing.join(", ")}`);
    Deno.exit(2);
  }
}

// Load KEY=VALUE lines into the process env (mirrors `set -a; . .env`) so
// child processes inherit them. A missing file is fine — CI injects real env.
export function loadDotEnv(path = ".env"): void {
  const text = (() => {
    try {
      return Deno.readTextFileSync(path);
    } catch {
      return null;
    }
  })();
  if (text === null) return;
  text.split("\n")
    .map((line) =>
      line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    )
    .filter((m): m is RegExpMatchArray => m !== null)
    .reduce((env, m) => {
      env.set(m[1], m[2].replace(/^(['"])(.*)\1$/, "$2"));
      return env;
    }, Deno.env);
}

// headscale prints human text with the key as the LAST line; some versions
// emit JSON. Accept both, and fail loudly on neither — an empty key must
// never reach an enrollment.
export function parseKeyOutput(stdout: string): string {
  const trimmed = stdout.trim();
  const parsed = (() => {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch (_notJson) {
      return null;
    }
  })();
  if (typeof parsed === "string" && parsed) return parsed;
  if (
    parsed && typeof parsed === "object" &&
    typeof (parsed as { key?: unknown }).key === "string"
  ) {
    return (parsed as { key: string }).key;
  }
  const last = trimmed.split("\n").filter((l) => l.trim()).at(-1)?.trim();
  if (!last) throw new Error("no key found in headscale output");
  return last;
}
