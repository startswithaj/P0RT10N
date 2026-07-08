import { fieldAnatomy } from "@ark-ui/solid/anatomy";
import { defineSlotRecipe } from "@pandacss/dev";

export const field = defineSlotRecipe({
  className: "field",
  slots: fieldAnatomy.keys(),
  base: {
    root: {
      display: "flex",
      flexDirection: "column",
      gap: "1.5",
    },
    label: {
      alignItems: "center",
      color: "fg.default",
      display: "flex",
      gap: "0.5",
      textAlign: "start",
      userSelect: "none",
      textStyle: "label",
      _disabled: {
        layerStyle: "disabled",
      },
    },
    requiredIndicator: {
      // LOCAL FIX: upstream says `colorPalette.solid`, a token no palette
      // defines (only solid.bg / solid.fg exist) — the declaration silently
      // dropped. Red matches the 0.43 behaviour (fg.error).
      color: "fg.error",
    },
    helperText: {
      color: "fg.muted",
      textStyle: "sm",
      _disabled: {
        layerStyle: "disabled",
      },
    },
    errorText: {
      color: "error",
      textStyle: "sm",
    },
  },
});
