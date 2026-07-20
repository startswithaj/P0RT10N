import { defineConfig } from "drizzle-kit";

// Generates SQL migrations from Schema.ts into ./drizzle. Boot + tests both
// apply those generated files via MigrationRunner — no hand-written DDL.
export default defineConfig({
  dialect: "sqlite",
  schema: "./app/packages/server/src/db/Schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: `file:${Deno.env.get("P0RT1ON_DB_PATH") ?? "./data/p0rt1on.db"}`,
  },
});
