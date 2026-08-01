/**
 * Deno lint plugin enforcing the client UI house rules from CODE.md.
 *
 * `no-raw-elements` flags a raw `<button>` or `<input>` JSX element in
 * favour of the Park UI wrappers.
 *
 * `no-hex-colors` flags a hex colour literal in favour of a semantic token
 * from `panda.config.ts`.
 *
 * Both rules exempt `components/ui/` and `styled-system/` because they are
 * generated (already excluded from lint in deno.json, guarded here too),
 * `theme/` files and `panda.config.ts` because they are the one place hex
 * values legitimately live as token definitions, and test files because
 * they may assert on whatever markup they need.
 */

const EXEMPT = [
  "/components/ui/",
  "/styled-system/",
  "/theme/",
  "panda.config.ts",
  ".test.",
];

const RAW_ELEMENTS = new Set(["button", "input"]);

// The regex matches the whole string only, so a DOM selector like "#app" or
// embedded hex-like text in a longer string never matches by accident.
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function exempt(filename: string): boolean {
  return EXEMPT.some((frag) => filename.includes(frag));
}

export default {
  name: "park-ui-idioms",
  rules: {
    "no-raw-elements": {
      create(context) {
        if (exempt(context.filename)) return {};
        return {
          JSXOpeningElement(node: Deno.lint.JSXOpeningElement) {
            if (node.name.type !== "JSXIdentifier") return;
            if (!RAW_ELEMENTS.has(node.name.name)) return;
            context.report({
              node,
              message:
                `Raw <${node.name.name}> — use the Park UI component from components/ui/ (Button, Input + Field) instead.`,
            });
          },
        };
      },
    },
    "no-hex-colors": {
      create(context) {
        if (exempt(context.filename)) return {};
        return {
          Literal(node: Deno.lint.Literal) {
            if (typeof node.value !== "string") return;
            if (!HEX_COLOR.test(node.value)) return;
            context.report({
              node,
              message:
                "Hex color literal — use a semantic token from panda.config.ts instead.",
            });
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
