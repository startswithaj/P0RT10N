import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";

// Mirrors vite.config.ts's solid plugin and styled-system alias; omits
// `@deno/vite-plugin` since npm deps resolve from node_modules here.
//
// `resolve.conditions` includes "development" so solid-js loads its dev
// build (reactivity and hydration warnings) under jsdom.
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
      // `@deno/vite-plugin` resolves these workspace imports in the real build;
      // alias the shared package's two exports to source since it's absent here.
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
      // json-summary feeds the client coverage gate; text is for humans.
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
        // The tRPC link/observable glue is awkward to unit-test; the demo
        // handlers/state/seed/dispatch it wires ARE covered.
        "src/demo/index.ts",
        "src/**/*.{test,spec}.{ts,tsx}",
      ],
    },
  },
});
