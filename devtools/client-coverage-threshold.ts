#!/usr/bin/env -S deno run --allow-read --allow-env
// Fails (exit 1) when the SolidJS client's line coverage is below THRESHOLD.
// Reads Vitest's v8 json-summary (coverage-summary.json). Generated Park UI
// components and Panda's styled-system output are excluded from the floor —
// vitest.config.ts already drops them from the report, but we filter again here
// so the gate enforces the correct scope even if that config is loosened.
// Run via: deno task coverage:check:client. Override with CLIENT_COVERAGE_THRESHOLD.

// Minimum acceptable line coverage of app/packages/client/src (excluding
// components/ui/ and styled-system/). Kept as a floor the suite must not sink below.
const THRESHOLD = Number(Deno.env.get("CLIENT_COVERAGE_THRESHOLD") ?? 75);
const SUMMARY_PATH = "app/packages/client/coverage/coverage-summary.json";

// Path fragments whose files never count toward the client coverage floor.
const EXCLUDED = ["/components/ui/", "/styled-system/"];

interface Metric {
  total: number;
  covered: number;
}
interface FileCoverage {
  lines: Metric;
}

const raw = await Deno.readTextFile(SUMMARY_PATH).catch(() => {
  console.error(
    `client-coverage-threshold: ${SUMMARY_PATH} not found — run coverage first`,
  );
  Deno.exit(2);
});

const summary = JSON.parse(raw) as Record<string, FileCoverage>;

const counted = Object.entries(summary)
  .filter(([path]) => path !== "total")
  .filter(([path]) => !EXCLUDED.some((frag) => path.includes(frag)));

const totalLines = counted.reduce((acc, [, f]) => acc + f.lines.total, 0);
const coveredLines = counted.reduce((acc, [, f]) => acc + f.lines.covered, 0);
const pct = totalLines === 0 ? 100 : (coveredLines / totalLines) * 100;

const fmt = (n: number) => `${n.toFixed(1)}%`;
console.log(
  `client coverage — lines ${fmt(pct)} across ${counted.length} files ` +
    `(gate: lines ≥ ${THRESHOLD}%)`,
);

if (pct < THRESHOLD) {
  console.error(
    `client-coverage-threshold: FAIL — line coverage ${
      fmt(pct)
    } < ${THRESHOLD}%`,
  );
  Deno.exit(1);
}
console.log("client-coverage-threshold: OK");
