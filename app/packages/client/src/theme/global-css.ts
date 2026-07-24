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
      // Declare the page dark in dark mode, else native scrollbars/selects/
      // autofill render light-styled on the dark canvas.
      _dark: { colorScheme: "dark" },
    },
  },
};
