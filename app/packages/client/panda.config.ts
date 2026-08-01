import { defineConfig } from "@pandacss/dev";
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
import { easings } from "~/theme/tokens/easings";
import { shadows } from "~/theme/tokens/shadows";
import { zIndex } from "~/theme/tokens/z-index";

// Copied into src/theme/ by `park-ui init`/`add` as project source we own
// and edit directly — unlike the generated styled-system/ output.
export default defineConfig({
  preflight: true,
  jsxFramework: "solid",
  include: ["./src/**/*.{ts,tsx,js,jsx}"],
  exclude: [],
  outdir: "styled-system",

  // No `presets` key: Panda's own defaults (preset-base + preset-panda)
  // already supply the base scales and `.dark` condition this theme builds on.

  conditions,

  globalCss: {
    extend: {
      ...parkGlobalCss.extend,
      // Park's html rule defaults colorPalette to gray; restating it as cyan
      // here is required, or every recipe's colorPalette.* resolves to gray.
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
        easings,
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

          // Overrides Park's gray-derived background with the synthwave canvas;
          // `bg.*` mirrors `canvas` under the names app code already uses.
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
          // Fixed in both themes because the cyan accent fill never flips, so
          // its ink can't either; the same value is duplicated in cyan.solid.fg.
          onAccent: { value: { base: "#160F2E", _dark: "#160F2E" } },
          // Fixed in both themes — the gold reads acceptably on both surfaces.
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
