/**
 * Deno lint plugin: `blank-line-around-multiline`.
 *
 * Within a statement list (a Program body or any block body), require a blank
 * line between two adjacent statements when EITHER of them is a MULTI-LINE
 * FUNCTION declaration — an arrow/function `const foo = () => { … }` or a
 * `function foo() { … }` that spans multiple lines. Such blocks should be
 * visually separated from their neighbours so they don't run together into one
 * dense wall.
 *
 * At MODULE TOP LEVEL the same air is required around a multi-line OBJECT-DATA
 * declaration — `export const x = css({ … })`, `const y = { … } as const` — so
 * a file of stacked style/config defs (e.g. `bundle-styles.ts`) doesn't run
 * together. This does NOT apply inside a function/component body: a multi-line
 * DATA declaration there (a `createSignal<…>(…)`, whether its arg wraps or
 * carries a multi-line object) is left alone — tight groups of related
 * state/assignments stay tight.
 *
 * A leading comment stays glued to the statement it documents: the required
 * blank line goes ABOVE the comment, never between the comment and its
 * statement.
 *
 * Autofixable: `deno lint --fix` inserts the missing blank line.
 *
 * Exemptions: `components/ui/` and `styled-system/` are generated.
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
        // Start of the line containing `offset` — the blank line is inserted
        // here so the block's indentation is preserved, not split.
        const lineStartOf = (offset: number): number => {
          let i = offset;
          while (i > 0 && text[i - 1] !== "\n") i--;
          return i;
        };
        const isMultiline = (node: Deno.lint.Node): boolean =>
          lineAt(node.range[1]) > lineAt(node.range[0]);

        // `export function foo` / `export const foo` wrap the declaration.
        const unwrap = (node: Deno.lint.Node): Deno.lint.Node =>
          node.type === "ExportNamedDeclaration" && node.declaration
            ? node.declaration
            : node;

        // A statement that DECLARES a function: `function foo() {}` or a
        // `const foo = () => …` / `= function () {}`. Data declarations (a
        // `createSignal(…)` call) and bare expression statements are not.
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

        // A multi-line object literal anywhere in the initializer: `= { … }`,
        // `= css({ … })`, `= foo(base, { … }) as const`. This — not a call
        // whose args merely wrap onto extra lines (a `createSignal<…>(…)`) —
        // is what makes a data declaration a wall.
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
        // A data declaration built from a multi-line object literal — a stack
        // of style/config defs that reads as a wall.
        const isObjectDecl = (node: Deno.lint.Node): boolean => {
          const n = unwrap(node);
          return n.type === "VariableDeclaration" &&
            n.declarations.some((d) => hasMultilineObject(d.init));
        };

        // The trigger: a multi-line function declaration always wants air; a
        // multi-line object-data declaration wants it only at module top level
        // (`atTop`) — inside a component body, tight state groups stay tight.
        const isBig = (node: Deno.lint.Node, atTop: boolean): boolean =>
          isMultiline(node) &&
          (isFnDecl(node) || (atTop && isObjectDecl(node)));

        const check = (statements: Deno.lint.Node[], atTop: boolean) => {
          for (let i = 1; i < statements.length; i++) {
            const prev = statements[i - 1];
            const cur = statements[i];
            if (!isBig(prev, atTop) && !isBig(cur, atTop)) continue;

            // Walk up from `cur` through the comment block glued directly above
            // it (each line adjacent, no blank gap) — that's where the required
            // blank line belongs, not between the comment and its statement.
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

            // A blank line between prev's end and the block start means the gap
            // holds two-or-more newlines (end-of-prev-line + the empty line).
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
