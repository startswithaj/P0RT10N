import { defineConfig } from "@pandacss/dev";
import { createPreset } from "@park-ui/panda-preset";
import slate from "@park-ui/panda-preset/colors/slate";
import brandCyan from "./src/theme/cyan-brand"; // custom Radix scale anchored on #2DE2E6
// Utility recipes the preset omits but Park's Button/Loader chain needs.
import { absoluteCenter, group } from "./src/theme/park-recipes";

/**
 * p0rt1on — Park UI (Ark UI + Panda) preset.
 *
 * Park UI is single-accent + single-gray on Radix 1–12 scales. We map the brand on:
 *   accentColor : brandCyan — custom palette anchored EXACTLY on #2DE2E6 (src/theme/cyan-brand.ts)
 *   grayColor   : slate     — cool blue-violet gray that reads as the indigo surfaces
 *   radius      : md        — adjust to taste
 *
 * The two brand things Park UI's model doesn't cover are layered on via theme.extend:
 *   1. The synthwave CANVAS — we pin bg.canvas / bg.default so dark mode is brand
 *      indigo (#160F2E / #1F1640), not Radix near-black.
 *   2. The magenta SPARK — Park is single-accent, so magenta lives as its own token
 *      (the 0/1 numerals, the aperture dot, primary CTAs). To drive Park components
 *      with it via `colorPalette="pink"`, add pink through the preset (see PARK-UI.md).
 *
 * Dark mode is Panda's `.dark` class condition (Park UI convention). The brand is
 * dark-first, so the app sets `class="dark"` on <html> by default (see App.tsx).
 * Panda condition convention: `base` = light, `_dark` = the `.dark` override.
 *
 * The accent is the custom brandCyan palette (step 9 = #2DE2E6). To go back to a
 * built-in, swap brandCyan for `cyan` from '@park-ui/panda-preset/colors/cyan'.
 */
export default defineConfig({
  preflight: true,
  jsxFramework: "solid",
  include: ["./src/**/*.{ts,tsx,js,jsx}"],
  exclude: [],
  outdir: "styled-system",

  // createPreset already bundles @pandacss/preset-base — don't add it again.
  presets: [
    createPreset({
      accentColor: brandCyan,
      grayColor: slate,
      radius: "md",
    }),
  ],

  theme: {
    extend: {
      recipes: {
        group,
        absoluteCenter,
      },
      keyframes: {
        spin: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      tokens: {
        fonts: {
          display: { value: "Bungee, system-ui, sans-serif" }, // wordmark / display only
          body: { value: '"Space Mono", ui-monospace, monospace' },
          heading: { value: '"Space Mono", ui-monospace, monospace' },
        },
        colors: {
          // raw magenta — the brand spark
          magenta: { value: "#FF2E97" },
        },
      },

      semanticTokens: {
        colors: {
          // Pin the synthwave canvas + surfaces (override Park's gray-derived bg).
          bg: {
            canvas: { value: { base: "#FBF8F0", _dark: "#160F2E" } },
            default: { value: { base: "#FFFFFF", _dark: "#1F1640" } },
          },
          // Logo ink flips cyan <-> indigo; the spark never flips.
          logoInk: { value: { base: "#160F2E", _dark: "#2DE2E6" } },
          spark: {
            value: { base: "{colors.magenta}", _dark: "{colors.magenta}" },
          },
          // Deep-indigo ink for text sitting on the brand cyan accent fill (active
          // segmented-toggle pill). Fixed in both themes — the cyan fill doesn't
          // flip, so neither should its ink.
          onAccent: { value: { base: "#160F2E", _dark: "#160F2E" } },
          // Amber "provisioning / near-quota" warning accent. Fixed in both
          // themes — the gold reads on both the light and dark surfaces.
          warning: { value: { base: "#E0A83E", _dark: "#E0A83E" } },
        },
      },
    },
  },

  // Park components read fg/bg tokens; this just sets the page defaults + body font.
  globalCss: {
    html: {
      fontFamily: "body",
      background: "bg.canvas",
      color: "fg.default",
    },
  },
});
