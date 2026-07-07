import { defineSemanticTokens } from "@pandacss/dev";

// BRAND OVERRIDE: this file was installed by `park-ui add cyan` (stock Radix
// cyan) and then re-anchored on the p0rt1on brand cyan — a custom Radix-style
// 1-12 scale whose dark step 9 is EXACTLY #2DE2E6 (see src/theme/cyan-brand.ts
// for the scale's provenance/notes; the values here are copied from it).
// Steps 9/10 are the solid brand cyan; 1-8 are backgrounds/borders, 11/12 are
// text. Alpha steps composite over white (light) / #0c1a1b (dark).
// `solid.fg` is deep-indigo ink (#160F2E, = the onAccent token) instead of
// Park's default white — the cyan fill is light, so its ink must be dark and
// must not flip with the theme.
export const cyan = defineSemanticTokens.colors({
  "1": { value: { _light: "#f5fefe", _dark: "#0c1a1b" } },
  "2": { value: { _light: "#e8fbfb", _dark: "#0a2223" } },
  "3": { value: { _light: "#d5f5f6", _dark: "#042e2f" } },
  "4": { value: { _light: "#c2efef", _dark: "#02393a" } },
  "5": { value: { _light: "#ade7e7", _dark: "#044446" } },
  "6": { value: { _light: "#96dcdd", _dark: "#005456" } },
  "7": { value: { _light: "#76cdcf", _dark: "#05696b" } },
  "8": { value: { _light: "#49b9bb", _dark: "#128587" } },
  "9": { value: { _light: "#1dc7cb", _dark: "#2DE2E6" } },
  "10": { value: { _light: "#1eb9bc", _dark: "#15d5d9" } },
  "11": { value: { _light: "#008d90", _dark: "#86ebed" } },
  "12": { value: { _light: "#0c5d5f", _dark: "#c7f8f8" } },
  a1: { value: { _light: "#00e6e60a", _dark: "#0c1a1b05" } },
  a2: { value: { _light: "#00d3d317", _dark: "#00feff09" } },
  a3: { value: { _light: "#00c2c82a", _dark: "#00feff16" } },
  a4: { value: { _light: "#00bcbc3d", _dark: "#00feff23" } },
  a5: { value: { _light: "#00b4b452", _dark: "#00f9ff30" } },
  a6: { value: { _light: "#00aaac69", _dark: "#00faff42" } },
  a7: { value: { _light: "#00a2a689", _dark: "#00fbff59" } },
  a8: { value: { _light: "#009da0b6", _dark: "#19fcff79" } },
  a9: { value: { _light: "#00c0c4e2", _dark: "#31fbffe3" } },
  a10: { value: { _light: "#00b0b3e1", _dark: "#17faffd5" } },
  a11: { value: { _light: "#008d90ff", _dark: "#90fdffeb" } },
  a12: { value: { _light: "#005557f3", _dark: "#cdfffff7" } },
  solid: {
    bg: {
      DEFAULT: {
        value: { _light: "{colors.cyan.9}", _dark: "{colors.cyan.9}" },
      },
      hover: {
        value: { _light: "{colors.cyan.10}", _dark: "{colors.cyan.10}" },
      },
    },
    // Brand: deep-indigo ink on the cyan fill (matches the onAccent token).
    fg: { DEFAULT: { value: { _light: "#160F2E", _dark: "#160F2E" } } },
  },
  subtle: {
    bg: {
      DEFAULT: {
        value: { _light: "{colors.cyan.a3}", _dark: "{colors.cyan.a3}" },
      },
      hover: {
        value: { _light: "{colors.cyan.a4}", _dark: "{colors.cyan.a4}" },
      },
      active: {
        value: { _light: "{colors.cyan.a5}", _dark: "{colors.cyan.a5}" },
      },
    },
    fg: {
      DEFAULT: {
        value: { _light: "{colors.cyan.a11}", _dark: "{colors.cyan.a11}" },
      },
    },
  },
  surface: {
    bg: {
      DEFAULT: {
        value: { _light: "{colors.cyan.a2}", _dark: "{colors.cyan.a2}" },
      },
      active: {
        value: { _light: "{colors.cyan.a3}", _dark: "{colors.cyan.a3}" },
      },
    },
    border: {
      DEFAULT: {
        value: { _light: "{colors.cyan.a6}", _dark: "{colors.cyan.a6}" },
      },
      hover: {
        value: { _light: "{colors.cyan.a7}", _dark: "{colors.cyan.a7}" },
      },
    },
    fg: {
      DEFAULT: {
        value: { _light: "{colors.cyan.a11}", _dark: "{colors.cyan.a11}" },
      },
    },
  },
  outline: {
    bg: {
      hover: {
        value: { _light: "{colors.cyan.a2}", _dark: "{colors.cyan.a2}" },
      },
      active: {
        value: { _light: "{colors.cyan.a3}", _dark: "{colors.cyan.a3}" },
      },
    },
    border: {
      DEFAULT: {
        value: { _light: "{colors.cyan.a7}", _dark: "{colors.cyan.a7}" },
      },
    },
    fg: {
      DEFAULT: {
        value: { _light: "{colors.cyan.a11}", _dark: "{colors.cyan.a11}" },
      },
    },
  },
  plain: {
    bg: {
      hover: {
        value: { _light: "{colors.cyan.a3}", _dark: "{colors.cyan.a3}" },
      },
      active: {
        value: { _light: "{colors.cyan.a4}", _dark: "{colors.cyan.a4}" },
      },
    },
    fg: {
      DEFAULT: {
        value: { _light: "{colors.cyan.a11}", _dark: "{colors.cyan.a11}" },
      },
    },
  },
});
