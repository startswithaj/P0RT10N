import plugin from "./one-component-per-file.ts";
import { assertEquals } from "jsr:@std/assert";

// A private component padded past the 40-line limit.
const bigPrivate = `function Big() {\n  return (\n    <div>\n${
  Array.from({ length: 45 }, (_, i) => `      <p>${i}</p>`).join("\n")
}\n    </div>\n  );\n}\n`;

Deno.test("passes when the exported component matches the filename", () => {
  const src = `export function StatusBadge() { return <b>x</b>; }\n`;
  const d = Deno.lint.runPlugin(plugin, "StatusBadge.tsx", src);
  assertEquals(d.length, 0);
});

Deno.test("flags the main component when its name doesn't match the file", () => {
  const src = `export function Aperture() { return <svg />; }\n`;
  const d = Deno.lint.runPlugin(plugin, "brand.tsx", src);
  assertEquals(d.length, 1);
});

Deno.test("flags a second exported component", () => {
  const src =
    `export function Aperture() { return <svg />; }\nexport function Wordmark() { return <span>hi</span>; }\n`;
  const d = Deno.lint.runPlugin(plugin, "Aperture.tsx", src);
  // Aperture matches the file (main, ok); Wordmark is a second public component.
  assertEquals(d.length, 1);
});

Deno.test("allows a small private helper component alongside the main one", () => {
  const src =
    `function Row() { return <tr />; }\nexport function StatusPage() { return <table><Row /></table>; }\n`;
  const d = Deno.lint.runPlugin(plugin, "StatusPage.tsx", src);
  assertEquals(d.length, 0);
});

Deno.test("flags a private component that exceeds the line limit", () => {
  const src =
    `${bigPrivate}export function StatusPage() { return <div><Big /></div>; }\n`;
  const d = Deno.lint.runPlugin(plugin, "StatusPage.tsx", src);
  assertEquals(d.length, 1);
});

Deno.test("allows one component plus non-JSX helpers", () => {
  const src =
    `function statusBadgeClass(s: string) { return s; }\nexport function StatusBadge() { return <b>x</b>; }\n`;
  const d = Deno.lint.runPlugin(plugin, "StatusBadge.tsx", src);
  assertEquals(d.length, 0);
});

Deno.test("ignores arrows nested in a JSX prop callback", () => {
  const src =
    `export function View() { return <For each={xs}>{(x) => <li>{x}</li>}</For>; }\n`;
  const d = Deno.lint.runPlugin(plugin, "View.tsx", src);
  assertEquals(d.length, 0);
});
