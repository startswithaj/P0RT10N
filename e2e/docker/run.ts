import $ from "@david/dax";
import { loadSync } from "@std/dotenv";
import { requireBinaries } from "../driver.ts";
import {
  DEFAULT_CLIENT_IMAGE,
  DEFAULT_INSTANCE_IMAGE,
  DEFAULT_MANAGER_IMAGE,
} from "../helpers.ts";

const MODES = ["all", "run"] as const;
const mode = Deno.args[0] ?? "all";
if (!(MODES as readonly string[]).includes(mode)) {
  console.error(
    `usage: deno task test:e2e:docker [${MODES.join("|")}]`,
  );
  Deno.exit(2);
}

Deno.chdir(new URL("../..", import.meta.url));
requireBinaries("docker");

// Images resolve before .env loads, because .env's P0RT1ON_INSTANCE_IMAGE
// is the stale dev image; .env is only used here for tailnet secrets.
const MANAGER_IMAGE = Deno.env.get("MANAGER_IMAGE") ?? DEFAULT_MANAGER_IMAGE;
const INSTANCE_IMAGE = Deno.env.get("P0RT1ON_INSTANCE_IMAGE") ??
  DEFAULT_INSTANCE_IMAGE;
const CLIENT_IMAGE = Deno.env.get("CLIENT_IMAGE") ?? DEFAULT_CLIENT_IMAGE;
loadSync({ export: true });

// Instances always join the fixed DOCKER_NETWORK, so the manager
// container must be on it too.
const NETWORK = "p0rt1on-net";
const net = await $`docker network inspect ${NETWORK}`.noThrow().quiet();
if (net.code !== 0) await $`docker network create ${NETWORK}`;

if (mode === "all") {
  await $`docker build -t ${MANAGER_IMAGE} .`;
  await $`docker build -t ${INSTANCE_IMAGE} instance`;
  await $`docker build -t ${CLIENT_IMAGE} backup-client`;
}

await $`deno test --allow-read --allow-write --allow-env --allow-net --allow-run e2e/docker/lifecycle.e2e.test.ts`
  .env({
    MANAGER_IMAGE,
    P0RT1ON_INSTANCE_IMAGE: INSTANCE_IMAGE,
    CLIENT_IMAGE,
  });
