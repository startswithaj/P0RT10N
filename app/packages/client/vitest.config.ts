import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";

// Vitest runner for the SolidJS client. Mirrors vite.config.ts where it must:
// the `styled-system` alias (Panda codegen output) and the solid plugin so JSX
// compiles the same way tests exercise it. The `@deno/vite-plugin` is NOT needed
// here — npm deps resolve from node_modules and `.ts`/`.tsx` imports are handled
// by Vite natively; the deno plugin only mattered for the dev/build import map.
//
// `resolve.conditions` includes "development" so solid-js loads its dev build
// (proper reactivity + hydration warnings) under jsdom.
export default defineConfig({
  plugins: [solid()],
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      "styled-system": fileURLToPath(
        new URL("./styled-system", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      // json-summary feeds the client coverage gate (US-012); text is for humans.
      reporter: ["text", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      // Generated code and entrypoints are excluded from the coverage floor.
      exclude: [
        "src/components/ui/**",
        "styled-system/**",
        "src/main.tsx",
        "src/**/*.{test,spec}.{ts,tsx}",
      ],
    },
  },
});
