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
  }),
};

export default brandCyan;
