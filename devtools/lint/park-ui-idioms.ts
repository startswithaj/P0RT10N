/**
 * Deno lint plugin enforcing the client UI house rules (CODE.md / PRD 6.1):
 *
 * - `no-raw-elements`: JSX must not use raw `<button>` / `<input>` — use the
 *   Park UI `Button` / `Input` (+`Field`) wrappers from `components/ui/`.
 * - `no-hex-colors`: no hex color literals in styles — use semantic tokens
 *   from `panda.config.ts`.
 *
 * Exemptions:
 * - `components/ui/` and `styled-system/` are generated (already excluded
 *   from lint in deno.json, guarded here too).
 * - `theme/` files and `panda.config.ts` are token DEFINITIONS — the one
 *   place hex values legitimately live.
 * - test files may assert on whatever markup they need.
 */

const EXEMPT = [
  "/components/ui/",
  "/styled-system/",
  "/theme/",
  "panda.config.ts",
  ".test.",
];

const RAW_ELEMENTS = new Set(["button", "input"]);

// A color literal: the whole string is #rgb / #rgba / #rrggbb / #rrggbbaa.
// Whole-string only, so DOM selectors like "#app" (non-hex letters) and URL
// fragments never match.
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
