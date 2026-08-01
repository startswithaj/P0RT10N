/**
 * Deno lint plugin: `comment-style`.
 *
 * Enforces the mechanical parts of comment style repo-wide; prose terseness
 * stays a human judgment call.
 *
 * Flags a `//` line comment that is just a row of `=`/`-`/`*` characters,
 * using plain prose instead.
 *
 * Flags a multi-line `/* … *\/` block comment that isn't a doc comment. A
 * single-line block comment is exempt because it's the only way to annotate
 * an inline empty body (`() => {/* noop *\/}`) without commenting out the
 * closing brace, and `.tsx` is fully exempt because JSX has no `//` syntax.
 *
 * Flags an issue/PRD/PLAN reference (`#123`, `PRD 1.3`, `PLAN §Foo`) because
 * it goes stale; state the reason in words instead. A hex colour literal is
 * not treated as a reference.
 *
 * Not autofixable — each flag needs a human to rewrite the prose.
 */

const BANNER = /^\s*[=\-*]{4,}\s*$/;
// Matches a `#` followed by digits with no hex letter immediately after (so
// it doesn't catch a hex colour), or a `PRD <n>` / `PLAN §` reference.
const REFS = /#\d+(?![\da-fA-F])|\bPRD\s*\d|PLAN\s*§/;

export default {
  name: "comment-style",
  rules: {
    "comment-style": {
      create(context) {
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
            // A doc comment's value starts with `*`, but a plain block
            // comment's does not; only a multi-line non-doc block is steered
            // to `//`, since a single-line block is a legitimate inline
            // marker.
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
