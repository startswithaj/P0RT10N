/**
 * True when `bin` is runnable (on PATH). Used to gate integration tests so the
 * suite runs only what the current environment supports — `mc` in the manager
 * container, `docker` on the host. Requires --allow-run.
 * `probeArgs` for tools without a `--version` flag (kubectl).
 */
export function hasBinary(
  bin: string,
  probeArgs: string[] = ["--version"],
): boolean {
  try {
    return new Deno.Command(bin, {
      args: probeArgs,
      stdout: "null",
      stderr: "null",
    }).outputSync().code === 0;
  } catch {
    return false; // not installed / not on PATH
  }
}
