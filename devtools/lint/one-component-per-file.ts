/**
 * Deno lint plugin: `one-component-per-file`.
 *
 * A SolidJS component is a top-level PascalCase function whose body contains
 * JSX. Each file has one "main" component and the rule keeps every file honest
 * about it:
 *
 * 1. The main component is the *exported* one; if nothing is exported, it's the
 *    *largest* by line count.
 * 2. The main component's name must match the filename (`Bundle.tsx` → `Bundle`).
 * 3. Any *other* exported component is flagged — each public component gets its
 *    own file so it can be imported, tested, and diffed on its own.
 * 4. A private (non-exported) helper component is allowed to sit alongside the
 *    main one only while it stays small (<= LIMIT lines); past that it's really
 *    its own component and must move out. This is what stops a file quietly
 *    growing back into the App.tsx pile-of-components smell.
 *
 * Non-component helpers (camelCase, or PascalCase factory hooks that return no
 * JSX) and arrows nested inside a component (e.g. a JSX prop callback) are
 * ignored.
 *
 * Exemptions:
 * - `components/ui/` and `styled-system/` are generated.
 * - test files may define whatever fixtures they need.
 */

const LIMIT = 40;

const EXEMPT = [
  "/components/ui/",
  "/styled-system/",
  ".test.",
];

function exempt(filename: string): boolean {
  return EXEMPT.some((frag) => filename.includes(frag));
}

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;

function basename(filename: string): string {
  const file = filename.split("/").pop() ?? filename;
  return file.replace(/\.(tsx|ts|jsx|js)$/, "");
}

// Deno lint AST nodes are lazily materialised, so a generic key-walk can't find
// nested JSX. Instead we collect the top-level PascalCase functions with their
// source ranges, let the JSX visitors flip a flag on whichever range encloses
// the JSX, and classify the components at Program:exit.
type Candidate = {
  name: string;
  node: Deno.lint.Node;
  range: [number, number];
  exported: boolean;
  isComponent: boolean;
};

export default {
  name: "one-component-per-file",
  rules: {
    "one-component-per-file": {
      create(context) {
        if (exempt(context.filename)) return {};
        const base = basename(context.filename);
        const text = context.sourceCode.text;
        const candidates: Candidate[] = [];

        const add = (
          name: string,
          node: Deno.lint.Node,
          body: Deno.lint.Node,
          exported: boolean,
        ) => {
          if (PASCAL.test(name)) {
            candidates.push({
              name,
              node,
              range: body.range,
              exported,
              isComponent: false,
            });
          }
        };

        const markEnclosing = (node: Deno.lint.Node) => {
          const [s, e] = node.range;
          for (const c of candidates) {
            if (c.range[0] <= s && e <= c.range[1]) c.isComponent = true;
          }
        };

        const lines = (c: Candidate) =>
          text.slice(c.range[0], c.range[1]).split("\n").length;

        return {
          "FunctionDeclaration"(node: Deno.lint.FunctionDeclaration) {
            // Any top-level function — `function Foo` or `export function Foo`.
            const parent = node.parent?.type;
            if (
              node.id &&
              (parent === "Program" ||
                parent === "ExportNamedDeclaration" ||
                parent === "ExportDefaultDeclaration")
            ) {
              add(
                node.id.name,
                node.id,
                node,
                parent === "ExportNamedDeclaration" ||
                  parent === "ExportDefaultDeclaration",
              );
            }
          },
          "VariableDeclarator"(node: Deno.lint.VariableDeclarator) {
            // Only top-level bindings — a `const Foo = () => <x/>` component, not
            // an arrow nested inside another component (e.g. a JSX prop callback).
            const declaration = node.parent; // VariableDeclaration
            const grandparent = declaration?.parent;
            const gpType = grandparent?.type;
            if (gpType !== "Program" && gpType !== "ExportNamedDeclaration") {
              return;
            }
            const init = node.init;
            if (
              node.id.type === "Identifier" && init &&
              (init.type === "ArrowFunctionExpression" ||
                init.type === "FunctionExpression")
            ) {
              add(
                node.id.name,
                node.id,
                init,
                gpType === "ExportNamedDeclaration",
              );
            }
          },
          JSXElement: markEnclosing,
          JSXFragment: markEnclosing,
          "Program:exit"() {
            const comps = candidates.filter((c) => c.isComponent);
            if (comps.length === 0) return;

            const exported = comps.filter((c) => c.exported);
            // Main = the exported component (prefer the one named after the file),
            // else the largest by line count.
            const main = exported.length > 0
              ? (exported.find((c) => c.name === base) ?? exported[0])
              : comps.reduce((a, b) => (lines(b) > lines(a) ? b : a));

            if (main.name !== base) {
              context.report({
                node: main.node,
                message:
                  `"${main.name}" is the main component of ${base}.tsx but its name doesn't match the file — rename one so they agree.`,
              });
            }

            for (const c of comps) {
              if (c === main) continue;
              if (c.exported) {
                context.report({
                  node: c.node,
                  message:
                    `"${c.name}" is a second exported component in this file — give each public component its own file under components/.`,
                });
              } else if (lines(c) > LIMIT) {
                context.report({
                  node: c.node,
                  message: `"${c.name}" is a ${
                    lines(c)
                  }-line private component (limit ${LIMIT}) — move it into its own file under components/.`,
                });
              }
            }
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
