// Shared plumbing for the integration DRIVERS (the run.ts files) — suites use
// helpers.ts. Spawning goes through dax, which quotes interpolated values.
import $ from "@david/dax";

export function requireBinaries(...bins: string[]): void {
  const missing = bins.filter((b) => !$.commandExistsSync(b));
  if (missing.length) {
    console.error(`missing required tools: ${missing.join(", ")}`);
    Deno.exit(2);
  }
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
