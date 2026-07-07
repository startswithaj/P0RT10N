// Vendors the discontinued @park-ui/panda-preset@0.43.1 theme as project
// source: calls createPreset with our exact arguments and serializes the
// result to src/theme/park-preset.generated.ts. Re-run after editing
// cyan-brand.ts (then fmt the output):
//   cd app/packages/client && deno run -A extract-legacy-preset.ts
//   deno fmt src/theme/park-preset.generated.ts
import { createPreset } from "npm:@park-ui/panda-preset@0.43.1";
import slate from "npm:@park-ui/panda-preset@0.43.1/colors/slate";
import { brandCyan } from "./src/theme/cyan-brand.ts";

const preset = createPreset({
  accentColor: brandCyan,
  grayColor: slate,
  radius: "md",
});

console.log("preset keys:", Object.keys(preset));

// Recipe `jsx` matchers are RegExp objects — JSON.stringify would silently
// turn them into {} (which broke Panda's extractor: "regex.test is not a
// function"). Encode each as a marker string here, then rewrite the markers
// into real regex literals in the emitted source. Refuse anything else
// non-serializable (functions).
const REGEX_MARKER = "__PARK_REGEX__";
const guard = (key: string, value: unknown) => {
  if (typeof value === "function") {
    throw new Error(`non-serializable function at key: ${key}`);
  }
  if (value instanceof RegExp) return `${REGEX_MARKER}${value.toString()}`;
  return value;
};

const body = JSON.stringify(preset, guard, 2).replaceAll(
  // "\_\_PARK_REGEX\_\_/pattern/flags" (JSON-escaped) -> /pattern/flags
  new RegExp(`"${REGEX_MARKER}(.*?)"`, "g"),
  (_, escaped: string) => JSON.parse(`"${escaped}"`),
);
const HEADER = `\
// ============================================================================
// GENERATED FILE — DO NOT EDIT BY HAND. Edits are lost on regeneration.
// ============================================================================
//
// This is the entire Park UI theme (recipes, tokens, semantic tokens,
// conditions, globalCss), vendored as project source. It is the exact output
// of the discontinued @park-ui/panda-preset@0.43.1 package's
//   createPreset({ accentColor: brandCyan, grayColor: slate, radius: "md" })
// serialized to disk by extract-legacy-preset.ts. Upstream froze that package
// in Nov 2024, so this file never changes unless we change our inputs.
//
// HOW TO CHANGE THE THEME:
//  - Brand accent colors   -> edit src/theme/cyan-brand.ts, then regenerate.
//  - Gray scale / radius   -> edit the createPreset args in
//                             extract-legacy-preset.ts, then regenerate.
//  - One-off recipe tweaks -> DON'T edit here; add a patch under theme.extend
//                             in panda.config.ts (see the SKEW PATCHES comment
//                             there for the pattern).
//
// REGENERATE:
//   cd app/packages/client
//   deno run -A extract-legacy-preset.ts
//   deno fmt src/theme/park-preset.generated.ts
// ============================================================================
`;

const OUT = "src/theme/park-preset.generated.ts";
await Deno.writeTextFile(
  OUT,
  HEADER +
    `import type { Preset } from "@pandacss/dev";\n\n` +
    `export const parkLegacyPreset = ${body} as unknown as Preset;\n\n` +
    `export default parkLegacyPreset;\n`,
);
console.log("wrote", OUT, body.length, "chars");
