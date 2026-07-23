import plugin from "./blank-line-around-multiline.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test("flags a multi-line const followed by another with no blank line", () => {
  const src = `function f() {
  const a = () => {
    return 1;
  };
  const b = () => {
    return 2;
  };
}
`;
  const d = Deno.lint.runPlugin(plugin, "f.ts", src);
  assertEquals(d.length, 1);
});

Deno.test("puts the blank line ABOVE a leading comment, not below it", () => {
  const src = `function f() {
  const a = () => {
    return 1;
  };
  // documents b
  const b = () => {
    return 2;
  };
}
`;
  const d = Deno.lint.runPlugin(plugin, "f.ts", src);
  assertEquals(d.length, 1);
  // The fix inserts a newline at the comment's start (above it).
  const fixed = d[0].fix?.[0];
  assertEquals(fixed?.text, "\n");
  assertEquals(
    src.slice(fixed!.range[0], fixed!.range[0] + 12),
    "  // documen",
  );
});

Deno.test("leaves adjacent multi-line DATA declarations alone", () => {
  // createSignal declarations that merely wrap onto several lines are not
  // functions — a tight group of related state stays tight.
  const src = `function f() {
  const [a, setA] = createSignal<"x" | "y" | "z">(
    "x",
  );
  const [b, setB] = createSignal<Thing>({
    kind: "pending",
    step: null,
  });
}
`;
  const d = Deno.lint.runPlugin(plugin, "f.ts", src);
  assertEquals(d.length, 0);
});

Deno.test("leaves adjacent single-line statements alone", () => {
  const src = `function f() {
  const a = 1;
  const b = 2;
  const c = 3;
}
`;
  const d = Deno.lint.runPlugin(plugin, "f.ts", src);
  assertEquals(d.length, 0);
});

Deno.test("flags adjacent top-level multi-line function declarations", () => {
  const src = `function a() {
  return 1;
}
function b() {
  return 2;
}
`;
  const d = Deno.lint.runPlugin(plugin, "f.ts", src);
  assertEquals(d.length, 1);
});

Deno.test("unwraps exported function declarations", () => {
  const src = `export function A() {
  return 1;
}
export function B() {
  return 2;
}
`;
  const d = Deno.lint.runPlugin(plugin, "f.ts", src);
  assertEquals(d.length, 1);
});

Deno.test("recognises a function-expression const", () => {
  const src = `function f() {
  const a = function () {
    return 1;
  };
  const b = function () {
    return 2;
  };
}
`;
  const d = Deno.lint.runPlugin(plugin, "f.ts", src);
  assertEquals(d.length, 1);
});

Deno.test("a comment detached by a blank line is not glued to the statement", () => {
  // The comment sits a blank line above `b`, so it belongs to nobody — the
  // block already has its separation and nothing is flagged.
  const src = `function f() {
  const a = () => {
    return 1;
  };

  // a floating remark
  const b = () => {
    return 2;
  };
}
`;
  const d = Deno.lint.runPlugin(plugin, "f.ts", src);
  assertEquals(d.length, 0);
});

Deno.test("flags a wall of top-level multi-line style declarations (bundle-styles before)", () => {
  // The state bundle-styles.ts was in: multi-line `css({…})` exports packed
  // against their neighbours with no separating blank lines.
  const src = `import { css } from "styled-system/css";

export const section = css({ mb: "6" });
export const eyebrow = css({
  fontSize: "xs",
  mb: "2",
});
export const codeWrap = css({ position: "relative" });
`;
  const d = Deno.lint.runPlugin(plugin, "bundle-styles.ts", src);
  // section↔eyebrow and eyebrow↔codeWrap both straddle a multi-line block.
  assertEquals(d.length, 2);
});

Deno.test("passes the spaced top-level style declarations (bundle-styles after)", () => {
  const src = `import { css } from "styled-system/css";

export const section = css({ mb: "6" });

export const eyebrow = css({
  fontSize: "xs",
  mb: "2",
});

export const codeWrap = css({ position: "relative" });
`;
  const d = Deno.lint.runPlugin(plugin, "bundle-styles.ts", src);
  assertEquals(d.length, 0);
});

Deno.test("recognises an object-literal declaration merged over a base (css(base, override))", () => {
  const src = `const base = {
  a: 1,
} as const;
export const merged = css(base, {
  b: 2,
});
`;
  const d = Deno.lint.runPlugin(plugin, "bundle-styles.ts", src);
  // base (object-as-const) ↔ merged (css(_, {…})) — both multi-line objects.
  assertEquals(d.length, 1);
});

Deno.test("passes when a blank line already separates the blocks", () => {
  const src = `function f() {
  const a = () => {
    return 1;
  };

  const b = () => {
    return 2;
  };
}
`;
  const d = Deno.lint.runPlugin(plugin, "f.ts", src);
  assertEquals(d.length, 0);
});
