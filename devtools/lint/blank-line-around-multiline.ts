/**
 * Deno lint plugin: `blank-line-around-multiline`.
 *
 * Requires a blank line between two adjacent statements in a statement list
 * (a Program body or any block body) when either one is a multi-line function
 * declaration, so the block doesn't run together with its neighbours.
 *
 * At module top level only, the same blank line is required around a
 * multi-line object-data declaration, so a file of stacked style/config defs
 * doesn't run together; inside a function or component body a multi-line data
 * declaration is left alone, so tight groups of related state stay tight.
 *
 * A leading comment stays glued to the statement it documents: the required
 * blank line goes above the comment, never between the comment and its
 * statement.
 *
 * Autofixable: `deno lint --fix` inserts the missing blank line.
 *
 * Exempts `components/ui/` and `styled-system/` because they are generated.
 */

const EXEMPT = ["/components/ui/", "/styled-system/"];

function exempt(filename: string): boolean {
  return EXEMPT.some((frag) => filename.includes(frag));
}

export default {
  name: "blank-line-around-multiline",
  rules: {
    "blank-line-around-multiline": {
      create(context) {
        if (exempt(context.filename)) return {};
        const sc = context.sourceCode;
        const text = sc.text;

        const lineAt = (offset: number): number => {
          let line = 1;
          for (let i = 0; i < offset && i < text.length; i++) {
            if (text[i] === "\n") line++;
          }
          return line;
        };
        // Returns the start of the line containing `offset`, so the blank
        // line is inserted before the line's indentation instead of
        // splitting it.
        const lineStartOf = (offset: number): number => {
          let i = offset;
          while (i > 0 && text[i - 1] !== "\n") i--;
          return i;
        };
        const isMultiline = (node: Deno.lint.Node): boolean =>
          lineAt(node.range[1]) > lineAt(node.range[0]);

        // An `export function foo` or `export const foo` declaration is
        // wrapped in an `ExportNamedDeclaration` node, so this unwraps it to
        // get the underlying declaration.
        const unwrap = (node: Deno.lint.Node): Deno.lint.Node =>
          node.type === "ExportNamedDeclaration" && node.declaration
            ? node.declaration
            : node;

        const isFnDecl = (node: Deno.lint.Node): boolean => {
          const n = unwrap(node);
          if (n.type === "FunctionDeclaration") return true;
          if (n.type === "VariableDeclaration") {
            return n.declarations.some((d) =>
              d.init?.type === "ArrowFunctionExpression" ||
              d.init?.type === "FunctionExpression"
            );
          }
          return false;
        };

        // Recognises a multi-line object literal anywhere in the
        // initializer, including nested inside an `as const` expression or a
        // call's arguments; a call whose arguments merely wrap onto extra
        // lines without containing an object literal, such as
        // `createSignal(…)`, does not count as a wall.
        const hasMultilineObject = (
          node: Deno.lint.Node | null | undefined,
        ): boolean => {
          if (!node) return false;
          if (node.type === "ObjectExpression") return isMultiline(node);
          if (node.type === "TSAsExpression") {
            return hasMultilineObject(node.expression);
          }
          if (node.type === "CallExpression") {
            return node.arguments.some(hasMultilineObject);
          }
          return false;
        };
        const isObjectDecl = (node: Deno.lint.Node): boolean => {
          const n = unwrap(node);
          return n.type === "VariableDeclaration" &&
            n.declarations.some((d) => hasMultilineObject(d.init));
        };

        const isBig = (node: Deno.lint.Node, atTop: boolean): boolean =>
          isMultiline(node) &&
          (isFnDecl(node) || (atTop && isObjectDecl(node)));

        const check = (statements: Deno.lint.Node[], atTop: boolean) => {
          for (let i = 1; i < statements.length; i++) {
            const prev = statements[i - 1];
            const cur = statements[i];
            if (!isBig(prev, atTop) && !isBig(cur, atTop)) continue;

            const comments = sc.getCommentsBefore(cur);
            let blockStart = cur.range[0];
            let anchorLine = lineAt(cur.range[0]);
            for (let c = comments.length - 1; c >= 0; c--) {
              const cm = comments[c];
              if (
                cm.range[0] >= prev.range[1] &&
                anchorLine - lineAt(cm.range[1]) <= 1
              ) {
                blockStart = cm.range[0];
                anchorLine = lineAt(cm.range[0]);
              } else break;
            }

            // A blank line between `prev`'s end and the block start means the
            // gap contains two or more newlines: one that ends `prev`'s
            // line, and one for the empty line itself.
            const gap = text.slice(prev.range[1], blockStart);
            if ((gap.match(/\n/g) ?? []).length >= 2) continue;

            const insertAt = lineStartOf(blockStart);
            context.report({
              range: [insertAt, insertAt],
              message:
                "Add a blank line here — a multi-line block should be separated from its neighbour.",
              fix(fixer) {
                return fixer.insertTextBeforeRange([insertAt, insertAt], "\n");
              },
            });
          }
        };

        return {
          Program(node: Deno.lint.Program) {
            check(node.body as Deno.lint.Node[], true);
          },
          BlockStatement(node: Deno.lint.BlockStatement) {
            check(node.body as Deno.lint.Node[], false);
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
