#!/usr/bin/env -S deno run --allow-read --allow-env
// Fails (exit 1) when line coverage is below THRESHOLD. Deno has no built-in
// coverage gate, so check:all calls this after generating coverage/lcov.info.
// Run via: deno task coverage:check. Override the gate with COVERAGE_THRESHOLD.

const THRESHOLD = Number(Deno.env.get("COVERAGE_THRESHOLD") ?? 95);
const LCOV_PATH = "coverage/lcov.info";

const text = await Deno.readTextFile(LCOV_PATH).catch(() => {
  console.error(
    `coverage-threshold: ${LCOV_PATH} not found — run coverage first`,
  );
  Deno.exit(2);
});

const allLines = text.split("\n");

/** Sum the numeric suffix of every `<prefix>N` record (e.g. "LF:" / "LH:"). */
const sumField = (prefix: string): number =>
  allLines
    .filter((line) => line.startsWith(prefix))
    .reduce((acc, line) => acc + Number(line.slice(prefix.length)), 0);

const pct = (hit: number, found: number): number =>
  found === 0 ? 100 : (hit / found) * 100;

const lines = pct(sumField("LH:"), sumField("LF:"));
const functions = pct(sumField("FNH:"), sumField("FNF:"));
const branches = pct(sumField("BRH:"), sumField("BRF:"));

const fmt = (n: number) => `${n.toFixed(1)}%`;
console.log(
  `coverage — lines ${fmt(lines)} · functions ${fmt(functions)} · branches ${
    fmt(branches)
  } (gate: lines ≥ ${THRESHOLD}%)`,
);

if (lines < THRESHOLD) {
  console.error(
    `coverage-threshold: FAIL — line coverage ${fmt(lines)} < ${THRESHOLD}%`,
  );
  Deno.exit(1);
}
console.log("coverage-threshold: OK");
