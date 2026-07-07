import { defineConfig } from "@pandacss/dev";
// Park UI v1 theme — everything under src/theme/ is project source installed
// by `npx @park-ui/cli init` / `add` (recipes: one file per component in
// ~/theme/recipes; palettes in ~/theme/colors; base tokens in ~/theme/tokens).
import { animationStyles } from "~/theme/animation-styles";
import { conditions } from "~/theme/conditions";
import { globalCss as parkGlobalCss } from "~/theme/global-css";
import { keyframes } from "~/theme/keyframes";
import { layerStyles } from "~/theme/layer-styles";
import { recipes, slotRecipes } from "~/theme/recipes";
import { textStyles } from "~/theme/text-styles";
import { cyan } from "~/theme/colors/cyan";
import { green } from "~/theme/colors/green";
import { red } from "~/theme/colors/red";
import { slate } from "~/theme/colors/slate";
import { colors } from "~/theme/tokens/colors";
import { durations } from "~/theme/tokens/durations";
import { shadows } from "~/theme/tokens/shadows";
import { zIndex } from "~/theme/tokens/z-index";

/**
 * p0rt1on — Park UI v1 (Ark UI + Panda), theme vendored as source (2026-07).
 *
 * Park UI v1 ships no theme package: `park-ui init`/`add` copy the theme and
 * per-component recipes into src/theme/ as source we own and edit. (This
 * replaced the earlier stop-gap that vendored the discontinued 0.43 preset's
 * output as one generated blob.)
 *
 * Park UI is single-accent + single-gray on Radix 1-12 scales. The brand maps:
 *   accent : cyan  — the stock file re-anchored on the brand scale so dark
 *            step 9 is EXACTLY #2DE2E6 (see BRAND OVERRIDE in colors/cyan.ts)
 *   gray   : slate — cool blue-violet gray; dark surfaces overridden to the
 *            brand indigo (see BRAND OVERRIDE in colors/slate.ts)
 *
 * The two brand things Park UI's model doesn't cover are layered on below:
 *   1. The synthwave CANVAS — `canvas` (used by Park's body rule) and
 *      bg.canvas / bg.default (used by app code) pin dark mode to brand
 *      indigo (#160F2E page / #1F1640 surfaces), not Radix near-black.
 *   2. The magenta SPARK — Park is single-accent, so magenta lives as its own
 *      token (the 0/1 numerals, the aperture dot, primary CTAs).
 *
 * Dark mode: Panda's `.dark` class condition. The brand is dark-first, so the
 * app sets `class="dark"` on <html> by default (see App.tsx / theme.ts).
 * v1 convention: tokens use `_light` / `_dark`; `_light` applies at :root.
 */
export default defineConfig({
  preflight: true,
  jsxFramework: "solid",
  include: ["./src/**/*.{ts,tsx,js,jsx}"],
  exclude: [],
  outdir: "styled-system",

  // No `presets` key: Panda's defaults (preset-base + preset-panda) supply the
  // base scales (radii.xs-lg, spacing, sizes, the `spin` keyframe) and the
  // `.dark` class condition that the v1 theme files build on.

  conditions,

  globalCss: {
    extend: {
      ...parkGlobalCss.extend,
      // Park's html rule sets `colorPalette: "gray"` — restate the rule with
      // the accent palette instead, or every recipe's colorPalette.* (radio
      // dot fill, focus rings, solid buttons) resolves to gray. Park's body
      // rule paints `background: canvas` (token defined below).
      html: {
        ...parkGlobalCss.extend["html"],
        colorPalette: "cyan",
        fontFamily: "body",
        color: "fg.default",
      },
    },
  },

  theme: {
    extend: {
      recipes,
      slotRecipes,
      animationStyles,
      layerStyles,
      textStyles,
      keyframes,

      tokens: {
        colors: {
          ...colors,
          // raw magenta — the brand spark
          magenta: { value: "#FF2E97" },
        },
        durations,
        zIndex,
        fonts: {
          display: { value: "Bungee, system-ui, sans-serif" }, // wordmark / display only
          body: { value: '"Space Mono", ui-monospace, monospace' },
          heading: { value: '"Space Mono", ui-monospace, monospace' },
        },
      },

      semanticTokens: {
        colors: {
          cyan,
          gray: slate,
          red,
          green,

          // Park v1 base semantics (what `park-ui init` writes).
          fg: {
            default: {
              value: { _light: "{colors.gray.12}", _dark: "{colors.gray.12}" },
            },
            muted: {
              value: { _light: "{colors.gray.11}", _dark: "{colors.gray.11}" },
            },
            subtle: {
              value: { _light: "{colors.gray.10}", _dark: "{colors.gray.10}" },
            },
            // 0.43 compat — app code styles error text with fg.error.
            error: {
              value: { _light: "{colors.red.9}", _dark: "{colors.red.9}" },
            },
          },
          border: {
            // v1's bare `border` token (gray.4), kept as DEFAULT so Park's
            // --global-color-border still resolves.
            DEFAULT: {
              value: { _light: "{colors.gray.4}", _dark: "{colors.gray.4}" },
            },
            // 0.43 compat — app code draws hairlines/outlines with these.
            default: {
              value: { _light: "{colors.gray.7}", _dark: "{colors.gray.7}" },
            },
            outline: {
              value: { _light: "{colors.gray.a9}", _dark: "{colors.gray.a9}" },
            },
            error: {
              value: { _light: "{colors.red.9}", _dark: "{colors.red.9}" },
            },
          },
          error: {
            value: { _light: "{colors.red.9}", _dark: "{colors.red.9}" },
          },

          // Pin the synthwave canvas + surfaces (override Park's gray-derived
          // bg). `canvas` is what Park's body rule paints; bg.* are the same
          // values under the names app code has always used.
          canvas: { value: { base: "#FBF8F0", _dark: "#160F2E" } },
          bg: {
            canvas: { value: { base: "#FBF8F0", _dark: "#160F2E" } },
            default: { value: { base: "#FFFFFF", _dark: "#1F1640" } },
            // 0.43 compat — progress tracks etc. use the muted wash.
            muted: {
              value: { _light: "{colors.gray.3}", _dark: "{colors.gray.4}" },
            },
          },

          // Logo ink flips cyan <-> indigo; the spark never flips.
          logoInk: { value: { base: "#160F2E", _dark: "#2DE2E6" } },
          spark: {
            value: { base: "{colors.magenta}", _dark: "{colors.magenta}" },
          },
          // Deep-indigo ink for text sitting on the brand cyan accent fill
          // (active segmented-toggle pill). Fixed in both themes — the cyan
          // fill doesn't flip, so neither should its ink. Also baked into
          // cyan.solid.fg (colors/cyan.ts) so solid-accent recipes get it.
          onAccent: { value: { base: "#160F2E", _dark: "#160F2E" } },
          // Amber "provisioning / near-quota" warning accent. Fixed in both
          // themes — the gold reads on both the light and dark surfaces.
          warning: { value: { base: "#E0A83E", _dark: "#E0A83E" } },
        },

        shadows,

        // Match the old 0.43 look (radius: "md"): sm/md/lg. (`park-ui init`
        // writes xs/sm/md regardless of the radius answer — upstream bug.)
        radii: {
          l1: { value: "{radii.sm}" },
          l2: { value: "{radii.md}" },
          l3: { value: "{radii.lg}" },
        },
      },
    },
  },
});
