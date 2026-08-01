import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import solid from "vite-plugin-solid";
import deno from "@deno/vite-plugin";
import pandacss from "@pandacss/dev/postcss";

/** Short commit hash for the footer version; "dev" outside a git checkout. */
function commitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim() || "dev";
  } catch {
    return "dev";
  }
}

// Docker bind-mount FS events don't propagate reliably on macOS, so Vite
// misses edits; P0RT1ON_DEV_POLLING=1 makes chokidar poll instead in the container.
const usePolling = Deno.env.get("P0RT1ON_DEV_POLLING") === "1";

// `@deno/vite-plugin` resolves the deno.json workspace imports, including
// `@p0rt1on/server` for AppRouter types.
export default defineConfig({
  define: { __COMMIT__: JSON.stringify(commitHash()) },
  plugins: [deno(), solid()],
  resolve: {
    alias: {
      "styled-system": fileURLToPath(
        new URL("./styled-system", import.meta.url),
      ),
    },
  },
  css: { postcss: { plugins: [pandacss()] } },
  server: {
    port: 5173,
    // Bind all interfaces so the port works when published from the container.
    host: true,
    watch: usePolling ? { usePolling: true, interval: 250 } : undefined,
    proxy: {
      "/trpc": "http://127.0.0.1:8080",
      "/health": "http://127.0.0.1:8080",
    },
  },
  // Build the SPA into the server package so the production image serves it
  // from there; the server finds ../dist next to itself (see main.ts).
  build: { outDir: "../server/dist", emptyOutDir: true },
});
