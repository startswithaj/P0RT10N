import { defineConfig } from "@pandacss/dev";
import parkLegacyPreset from "./src/theme/park-preset.generated";
// Utility recipes the preset omits but Park's Button/Loader chain needs.
import { absoluteCenter, group } from "./src/theme/park-recipes";

/**
 * p0rt1on — Park UI (Ark UI + Panda), legacy 0.43 theme vendored as source.
 *
 * The @park-ui/panda-preset package is discontinued upstream (frozen at 0.43.1,
 * Nov 2024), so its exact output — createPreset({ accentColor: brandCyan,
 * grayColor: slate, radius: "md" }) — is extracted into
 * src/theme/park-preset.generated.ts (see extract-legacy-preset.ts). Same CSS
 * as before, but the theme is now source we own instead of a frozen npm black
 * box.
 *
 * Park UI is single-accent + single-gray on Radix 1–12 scales. The brand maps:
 *   accentColor : brandCyan — custom palette anchored EXACTLY on #2DE2E6
 *                 (src/theme/cyan-brand.ts — feeds the extraction script)
 *   grayColor   : slate     — cool blue-violet gray that reads as the indigo surfaces
 *   radius      : md
 *
 * The two brand things Park UI's model doesn't cover are layered on via theme.extend:
 *   1. The synthwave CANVAS — we pin bg.canvas / bg.default so dark mode is brand
 *      indigo (#160F2E / #1F1640), not Radix near-black.
 *   2. The magenta SPARK — Park is single-accent, so magenta lives as its own token
 *      (the 0/1 numerals, the aperture dot, primary CTAs).
 *
 * SKEW PATCHES: the CLI-copied v1-era component wrappers in components/ui/
 * reference recipe slots/variants the 0.43 theme never defined. Panda merges the
 * additions below into the vendored recipes (field.requiredIndicator,
 * spinner size=inherit, switch.indicator, button variant=plain).
 *
 * Dark mode is Panda's `.dark` class condition (Park UI convention). The brand is
 * dark-first, so the app sets `class="dark"` on <html> by default (see App.tsx).
 * Panda condition convention: `base` = light, `_dark` = the `.dark` override.
 */
export default defineConfig({
  preflight: true,
  jsxFramework: "solid",
  include: ["./src/**/*.{ts,tsx,js,jsx}"],
  exclude: [],
  outdir: "styled-system",

  // parkLegacyPreset references @pandacss/preset-base by name — don't add it again.
  presets: [parkLegacyPreset],

  theme: {
    extend: {
      recipes: {
        group,
        absoluteCenter,
        // Skew patch: v1 close-button/App buttons use variant="plain" — style it
        // like the 0.43 ghost variant (transparent, gray hover wash).
        button: {
          className: "button",
          variants: {
            variant: {
              plain: {
                color: "fg.default",
                _hover: { background: "gray.a3" },
                _selected: { background: "gray.a3" },
              },
            },
          },
        },
        // Skew patch: v1 loader.tsx renders <Spinner size="inherit">.
        spinner: {
          className: "spinner",
          variants: {
            size: { inherit: { "--size": "1em" } },
          },
        },
      },
      slotRecipes: {
        // Skew patch: v1 field.tsx exports a RequiredIndicator slot.
        field: {
          className: "field",
          slots: ["requiredIndicator"],
          base: { requiredIndicator: { color: "fg.error" } },
        },
        // Skew patch: v1 switch.tsx exports an Indicator slot.
        switchRecipe: {
          className: "switch",
          slots: ["indicator"],
          base: {
            indicator: {
              display: "grid",
              placeItems: "center",
              height: "full",
            },
          },
        },
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
      // The legacy preset sets `html { colorPalette: "brandcyan" }` in its own
      // globalCss, but this html block overrides it — restate it or every
      // recipe's `colorPalette.default` (radio dot fill, focus rings) resolves
      // to nothing.
      colorPalette: "brandcyan",
      fontFamily: "body",
      background: "bg.canvas",
      color: "fg.default",
    },
  },
});
