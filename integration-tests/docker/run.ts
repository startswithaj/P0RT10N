// Docker + REAL tailnet portion tier. Unlike the k8s tiers (secretless), this
// needs a real Tailscale OAuth client — it is the only tier proving
// `tailscale serve` over HTTPS with real certs.
//
//   deno task test:integration:docker          # build images + run
//   deno task test:integration:docker run      # run (images built)
//
// Locally reads .env (the same file `docker compose` uses); in CI the vars
// are injected as secrets.
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
    `usage: deno task test:integration:docker [${MODES.join("|")}]`,
  );
  Deno.exit(2);
}

// All paths below are repo-root relative.
Deno.chdir(new URL("../..", import.meta.url));
requireBinaries("docker");

// Images come from the REAL environment (CI) or the integration defaults —
// resolved BEFORE .env loads, because .env's P0RT1ON_INSTANCE_IMAGE is the
// DEV image (stale for tests). .env is only for the tailnet secrets.
const MANAGER_IMAGE = Deno.env.get("MANAGER_IMAGE") ?? DEFAULT_MANAGER_IMAGE;
const INSTANCE_IMAGE = Deno.env.get("P0RT1ON_INSTANCE_IMAGE") ??
  DEFAULT_INSTANCE_IMAGE;
const CLIENT_IMAGE = Deno.env.get("CLIENT_IMAGE") ?? DEFAULT_CLIENT_IMAGE;
loadSync({ export: true });

// Fixed in the runtime (DOCKER_NETWORK) — instances always join this one,
// and the manager container must be on it too.
const NETWORK = "p0rt1on-net";
const net = await $`docker network inspect ${NETWORK}`.noThrow().quiet();
if (net.code !== 0) await $`docker network create ${NETWORK}`;

if (mode === "all") {
  // --target integration: the suites live only in that stage.
  await $`docker build --target integration -t ${MANAGER_IMAGE} .`;
  await $`docker build -t ${INSTANCE_IMAGE} instance`;
  await $`docker build -t ${CLIENT_IMAGE} backup-client`;
}

await $`deno test --allow-read --allow-write --allow-env --allow-net --allow-run integration-tests/docker/tailnet-lifecycle.integration.test.ts`
  .env({
    MANAGER_IMAGE,
    P0RT1ON_INSTANCE_IMAGE: INSTANCE_IMAGE,
    CLIENT_IMAGE,
  });
