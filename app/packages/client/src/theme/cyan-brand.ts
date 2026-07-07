import { defineSemanticTokens, defineTokens } from "@pandacss/dev";

/**
 * p0rt1on brand cyan — a custom Radix-style 1-12 scale anchored EXACTLY on #2DE2E6
 * (brand accent = dark step 9). Generated via OKLCH interpolation on the brand hue
 * (~-163 deg). Steps 9/10 are the solid brand cyan; 1-8 are backgrounds/
 * borders and 11/12 are text. Regenerate from the Radix custom-color tool to hand-tune.
 */
export const brandCyan = {
  name: "brandcyan",
  tokens: defineTokens.colors({
    light: {
      "1": { value: "#f5fefe" },
      "2": { value: "#e8fbfb" },
      "3": { value: "#d5f5f6" },
      "4": { value: "#c2efef" },
      "5": { value: "#ade7e7" },
      "6": { value: "#96dcdd" },
      "7": { value: "#76cdcf" },
      "8": { value: "#49b9bb" },
      "9": { value: "#1dc7cb" },
      "10": { value: "#1eb9bc" },
      "11": { value: "#008d90" },
      "12": { value: "#0c5d5f" },
      // Alpha steps: translucent colors that composite over white to the exact
      // solid step above (Radix a-scale convention; used by ghost/subtle hovers).
      a1: { value: "#00e6e60a" },
      a2: { value: "#00d3d317" },
      a3: { value: "#00c2c82a" },
      a4: { value: "#00bcbc3d" },
      a5: { value: "#00b4b452" },
      a6: { value: "#00aaac69" },
      a7: { value: "#00a2a689" },
      a8: { value: "#009da0b6" },
      a9: { value: "#00c0c4e2" },
      a10: { value: "#00b0b3e1" },
      a11: { value: "#008d90ff" },
      a12: { value: "#005557f3" },
    },
    dark: {
      "1": { value: "#0c1a1b" },
      "2": { value: "#0a2223" },
      "3": { value: "#042e2f" },
      "4": { value: "#02393a" },
      "5": { value: "#044446" },
      "6": { value: "#005456" },
      "7": { value: "#05696b" },
      "8": { value: "#128587" },
      "9": { value: "#2DE2E6" },
      "10": { value: "#15d5d9" },
      "11": { value: "#86ebed" },
      "12": { value: "#c7f8f8" },
      // Alpha steps composite over the dark page base (dark.1 #0c1a1b).
      a1: { value: "#0c1a1b05" },
      a2: { value: "#00feff09" },
      a3: { value: "#00feff16" },
      a4: { value: "#00feff23" },
      a5: { value: "#00f9ff30" },
      a6: { value: "#00faff42" },
      a7: { value: "#00fbff59" },
      a8: { value: "#19fcff79" },
      a9: { value: "#31fbffe3" },
      a10: { value: "#17faffd5" },
      a11: { value: "#90fdffeb" },
      a12: { value: "#cdfffff7" },
    },
  }),
  semanticTokens: defineSemanticTokens.colors({
    "1": {
      value: {
        _light: "{colors.brandcyan.light.1}",
        _dark: "{colors.brandcyan.dark.1}",
      },
    },
    "2": {
      value: {
        _light: "{colors.brandcyan.light.2}",
        _dark: "{colors.brandcyan.dark.2}",
      },
    },
    "3": {
      value: {
        _light: "{colors.brandcyan.light.3}",
        _dark: "{colors.brandcyan.dark.3}",
      },
    },
    "4": {
      value: {
        _light: "{colors.brandcyan.light.4}",
        _dark: "{colors.brandcyan.dark.4}",
      },
    },
    "5": {
      value: {
        _light: "{colors.brandcyan.light.5}",
        _dark: "{colors.brandcyan.dark.5}",
      },
    },
    "6": {
      value: {
        _light: "{colors.brandcyan.light.6}",
        _dark: "{colors.brandcyan.dark.6}",
      },
    },
    "7": {
      value: {
        _light: "{colors.brandcyan.light.7}",
        _dark: "{colors.brandcyan.dark.7}",
      },
    },
    "8": {
      value: {
        _light: "{colors.brandcyan.light.8}",
        _dark: "{colors.brandcyan.dark.8}",
      },
    },
    "9": {
      value: {
        _light: "{colors.brandcyan.light.9}",
        _dark: "{colors.brandcyan.dark.9}",
      },
    },
    "10": {
      value: {
        _light: "{colors.brandcyan.light.10}",
        _dark: "{colors.brandcyan.dark.10}",
      },
    },
    "11": {
      value: {
        _light: "{colors.brandcyan.light.11}",
        _dark: "{colors.brandcyan.dark.11}",
      },
    },
    "12": {
      value: {
        _light: "{colors.brandcyan.light.12}",
        _dark: "{colors.brandcyan.dark.12}",
      },
    },
    a1: {
      value: {
        _light: "{colors.brandcyan.light.a1}",
        _dark: "{colors.brandcyan.dark.a1}",
      },
    },
    a2: {
      value: {
        _light: "{colors.brandcyan.light.a2}",
        _dark: "{colors.brandcyan.dark.a2}",
      },
    },
    a3: {
      value: {
        _light: "{colors.brandcyan.light.a3}",
        _dark: "{colors.brandcyan.dark.a3}",
      },
    },
    a4: {
      value: {
        _light: "{colors.brandcyan.light.a4}",
        _dark: "{colors.brandcyan.dark.a4}",
      },
    },
    a5: {
      value: {
        _light: "{colors.brandcyan.light.a5}",
        _dark: "{colors.brandcyan.dark.a5}",
      },
    },
    a6: {
      value: {
        _light: "{colors.brandcyan.light.a6}",
        _dark: "{colors.brandcyan.dark.a6}",
      },
    },
    a7: {
      value: {
        _light: "{colors.brandcyan.light.a7}",
        _dark: "{colors.brandcyan.dark.a7}",
      },
    },
    a8: {
      value: {
        _light: "{colors.brandcyan.light.a8}",
        _dark: "{colors.brandcyan.dark.a8}",
      },
    },
    a9: {
      value: {
        _light: "{colors.brandcyan.light.a9}",
        _dark: "{colors.brandcyan.dark.a9}",
      },
    },
    a10: {
      value: {
        _light: "{colors.brandcyan.light.a10}",
        _dark: "{colors.brandcyan.dark.a10}",
      },
    },
    a11: {
      value: {
        _light: "{colors.brandcyan.light.a11}",
        _dark: "{colors.brandcyan.dark.a11}",
      },
    },
    a12: {
      value: {
        _light: "{colors.brandcyan.light.a12}",
        _dark: "{colors.brandcyan.dark.a12}",
      },
    },
    // Park UI recipe aliases (colorPalette.default etc.) — same shape as the
    // preset's built-in colors: default = solid step 9, emphasized = 10,
    // text = 11. fg is the text-on-solid color; Park's cyan uses white, but
    // #2DE2E6 is far too bright for white text, so we use the darkest teal.
    default: {
      value: {
        _light: "{colors.brandcyan.light.9}",
        _dark: "{colors.brandcyan.dark.9}",
      },
    },
    emphasized: {
      value: {
        _light: "{colors.brandcyan.light.10}",
        _dark: "{colors.brandcyan.dark.10}",
      },
    },
    fg: {
      value: {
        _light: "{colors.brandcyan.dark.1}",
        _dark: "{colors.brandcyan.dark.1}",
      },
    },
    text: {
      value: {
        _light: "{colors.brandcyan.light.11}",
        _dark: "{colors.brandcyan.dark.11}",
      },
    },
  }),
};

export default brandCyan;
