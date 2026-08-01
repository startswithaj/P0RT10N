#!/usr/bin/env -S deno run --allow-read --allow-env
// Park UI components and Panda's styled-system output are excluded from the
// floor; vitest.config.ts already drops them from the report, but this filters
// again so the gate still enforces the correct scope if that config is ever
// loosened.

const THRESHOLD = Number(Deno.env.get("CLIENT_COVERAGE_THRESHOLD") ?? 75);
const SUMMARY_PATH = "app/packages/client/coverage/coverage-summary.json";

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
