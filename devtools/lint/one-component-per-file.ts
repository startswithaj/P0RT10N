/**
 * Deno lint plugin: `one-component-per-file`.
 *
 * A SolidJS component is a top-level PascalCase function whose body contains
 * JSX, and each file may have one main component.
 *
 * The main component is the exported one, or the largest by line count if
 * none is exported, and its name must match the filename. Any other exported
 * component is flagged, since each public component should get its own file.
 * A private helper component may sit alongside the main one only while it
 * stays at or under LIMIT lines; past that it must move to its own file.
 *
 * A camelCase helper, a PascalCase function that returns no JSX, and an arrow
 * function nested inside a component (such as a JSX prop callback) are all
 * ignored.
 *
 * Exemptions: `components/ui/` and `styled-system/` are generated, and test
 * files may define whatever fixtures they need.
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

// Deno lint's AST nodes are lazily materialised, so a generic key-walk cannot
// find nested JSX; instead this collects the top-level PascalCase functions
// by source range, lets the JSX visitors flag whichever range encloses the
// JSX, and classifies the components at `Program:exit`.
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
            // `declaration` is a `VariableDeclaration` node.
            const declaration = node.parent;
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
