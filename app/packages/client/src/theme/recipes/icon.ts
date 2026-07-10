import { defineRecipe } from "@pandacss/dev";

export const icon = defineRecipe({
  className: "icon",
  base: {
    color: "currentcolor",
    display: "inline-block",
    flexShrink: "0",
    verticalAlign: "middle",
    lineHeight: "1em",
    // The child is a lucide <svg> with a fixed width/height; scale it to the
    // box (the span is a normal HTML box, so this applies cleanly).
    "& > svg": { width: "100%", height: "100%", display: "block" },
  },
  defaultVariants: {
    size: "md",
  },
  variants: {
    size: {
      "2xs": { boxSize: "3" },
      xs: { boxSize: "4" },
      sm: { boxSize: "4.5" },
      md: { boxSize: "5" },
      lg: { boxSize: "5.5" },
      xl: { boxSize: "6" },
    },
  },
});
