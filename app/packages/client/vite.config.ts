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

// Solid SPA built by Vite. `@deno/vite-plugin` resolves the deno.json imports
// (incl. the @p0rt1on/server workspace package for AppRouter types). Panda CSS
// runs as a PostCSS plugin. During dev, /trpc is proxied to the local API server.
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
    proxy: {
      "/trpc": "http://127.0.0.1:8080",
      "/health": "http://127.0.0.1:8080",
    },
  },
  // Build the SPA into the server package so the production image serves it
  // from there (STATIC_DIR); mirrors how the manager locates the assets.
  build: { outDir: "../server/dist", emptyOutDir: true },
});
