import plugin from "./comment-style.ts";
import { assertEquals } from "jsr:@std/assert";

const run = (src: string, file = "x.ts") =>
  Deno.lint.runPlugin(plugin, file, src);

Deno.test("flags a decorative banner line", () => {
  const src =
    `// ============================================================\nconst x = 1;\n`;
  assertEquals(run(src).length, 1);
});

Deno.test("flags a dash banner line", () => {
  assertEquals(run(`// ------------\nconst x = 1;\n`).length, 1);
});

Deno.test("allows plain line comments", () => {
  assertEquals(run(`// a normal comment\nconst x = 1;\n`).length, 0);
});

Deno.test("flags a multi-line non-doc block comment", () => {
  assertEquals(run(`/* line one\n   line two */\nconst x = 1;\n`).length, 1);
});

Deno.test("allows a single-line inline block comment (empty-body marker)", () => {
  assertEquals(run(`const f = () => {/* noop */};\n`).length, 0);
});

Deno.test("allows a JSDoc block comment", () => {
  assertEquals(run(`/** doc */\nexport const x = 1;\n`).length, 0);
});

Deno.test("exempts .tsx from the block-comment rule (JSX needs {/* */})", () => {
  const src =
    `const El = () => (\n  <div>\n    {/* a JSX\n        comment */}\n  </div>\n);\n`;
  assertEquals(run(src, "El.tsx").length, 0);
});

Deno.test("does not flag a hex colour in a comment", () => {
  assertEquals(
    run(`// step 9 is #2DE2E6 over #0c1a1b\nconst x = 1;\n`).length,
    0,
  );
});

Deno.test("flags a #issue reference", () => {
  assertEquals(run(`// pending #9 landing\nconst x = 1;\n`).length, 1);
});

Deno.test("flags a PRD reference", () => {
  assertEquals(run(`// reused by PRD 1.3\nconst x = 1;\n`).length, 1);
});

Deno.test("flags a PLAN section reference", () => {
  assertEquals(run(`// see PLAN §Connectivity\nconst x = 1;\n`).length, 1);
});

Deno.test("allows a hex-like #fff only outside comments (no comment ref)", () => {
  assertEquals(run(`// uses the accent color token\nconst x = 1;\n`).length, 0);
});

Deno.test("a TODO comment with plain reason is fine", () => {
  assertEquals(
    run(`// TODO: wire the stream to the aggregator\nconst x = 1;\n`).length,
    0,
  );
});
