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
  // Mirror vite.config.ts's build-time inject: App's footer reads `__COMMIT__`,
  // so it must be defined under the test runner too (a literal, not the git hash).
  define: { __COMMIT__: JSON.stringify("test") },
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      "styled-system": fileURLToPath(
        new URL("./styled-system", import.meta.url),
      ),
      // The `@deno/vite-plugin` (which resolves these workspace imports in the
      // real build) is deliberately absent here, so alias the shared package's
      // two exports to their source files for component tests.
      "@p0rt1on/shared/domain": fileURLToPath(
        new URL("../shared/domain.ts", import.meta.url),
      ),
      "@p0rt1on/shared/steps": fileURLToPath(
        new URL("../shared/steps.ts", import.meta.url),
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
      // src/theme/ is registry-copied Park UI v1 token/recipe data (no logic).
      exclude: [
        "src/components/ui/**",
        "src/theme/**",
        "styled-system/**",
        "src/main.tsx",
        "src/**/*.{test,spec}.{ts,tsx}",
      ],
    },
  },
});
