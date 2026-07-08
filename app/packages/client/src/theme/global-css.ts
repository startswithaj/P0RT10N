export const globalCss = {
  extend: {
    "*": {
      "--global-color-border": "colors.border",
      "--global-color-placeholder": "colors.fg.subtle",
      "--global-color-selection": "colors.colorPalette.subtle.bg",
      "--global-color-focus-ring": "colors.colorPalette.solid.bg",
    },
    html: {
      colorPalette: "gray",
    },
    body: {
      background: "canvas",
      color: "fg.default",
      // LOCAL FIX (restores 0.43 behaviour): tell the browser the page is
      // dark in dark mode, or native scrollbars / selects / autofill render
      // light-styled on the dark indigo canvas.
      _dark: { colorScheme: "dark" },
    },
  },
};
