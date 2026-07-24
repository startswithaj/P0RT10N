import { defineTokens } from "@pandacss/dev";

// Park v1 recipes reference `emphasized-in`/`emphasized-out` timing functions
// but never define them (browser fell back to `ease`). These are the
// Material 3 "emphasized" curves: decelerate for entering, accelerate for
// exiting.
export const easings = defineTokens.easings({
  "emphasized-in": { value: "cubic-bezier(0.05, 0.7, 0.1, 1.0)" },
  "emphasized-out": { value: "cubic-bezier(0.3, 0.0, 0.8, 0.15)" },
});
