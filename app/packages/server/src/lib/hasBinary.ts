/**
 * True when `bin` is runnable (on PATH). Used to gate integration tests so the
 * suite runs only what the current environment supports — `mc` in the manager
 * container, `docker` on the host. Requires --allow-run.
 */
export function hasBinary(bin: string): boolean {
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
