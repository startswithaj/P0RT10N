/**
 * Deno lint plugin: `comment-style`.
 *
 * Enforces one consistent comment style repo-wide (the mechanical parts — prose
 * terseness stays a human judgment call):
 *
 *  - NO decorative banner lines — a `//` comment that is just a row of `=`/`-`/`*`
 *    (the old `// ====` box framing). Use plain prose.
 *  - NO multi-line non-doc block comments — a `/* … *\/` spanning lines should be
 *    `//` lines, or `/** … *\/` if it documents an export. Single-line block
 *    comments are left alone: they're the only way to annotate an inline empty
 *    body (`() => {/* noop *\/}`) without commenting out the closing brace, and
 *    JSX (`.tsx`) has no line-comment syntax at all, so `.tsx` is fully exempt.
 *  - NO issue/PRD/PLAN refs in comments — `#123`, `PRD 1.3`, `PLAN §Foo`. These
 *    go stale and leak planning trivia into code. State the reason in words.
 *    Hex colour literals (`#0c1a1b`) are not refs and are not flagged.
 *
 * Not autofixable — each flag needs a human to rewrite the prose.
 */

const BANNER = /^\s*[=\-*]{4,}\s*$/;
// `#` + digits that are NOT part of a hex colour (no hex letter follows), or a
// `PRD <n>` / `PLAN §` reference.
const REFS = /#\d+(?![\da-fA-F])|\bPRD\s*\d|PLAN\s*§/;

export default {
  name: "comment-style",
  rules: {
    "comment-style": {
      create(context) {
        // JSX has no `//` syntax — its only comment form is `{/* … */}`, so the
        // non-doc-block check cannot apply to `.tsx`.
        const isTsx = context.filename.endsWith(".tsx");
        const comments = context.sourceCode.getAllComments();

        for (const comment of comments) {
          const range = comment.range as [number, number];

          if (comment.type === "Line") {
            if (BANNER.test(comment.value)) {
              context.report({
                range,
                message:
                  "Decorative banner comment — drop the `====` framing, keep plain prose.",
              });
              continue;
            }
          } else if (comment.type === "Block") {
            // A doc comment's value starts with `*` (`/** … */`); a plain
            // `/* … */` block does not. Only multi-line non-doc blocks are
            // steered to `//` — single-line ones are legit inline markers.
            const isDoc = comment.value.startsWith("*");
            const multiLine = comment.value.includes("\n");
            if (!isDoc && multiLine && !isTsx) {
              context.report({
                range,
                message:
                  "Multi-line non-doc block comment — use `//` lines (or `/** */` for docs).",
              });
            }
          }

          if (REFS.test(comment.value)) {
            context.report({
              range,
              message:
                "Issue/PRD/PLAN reference in a comment — it goes stale; state the reason in words.",
            });
          }
        }

        return {};
      },
    },
  },
} satisfies Deno.lint.Plugin;
