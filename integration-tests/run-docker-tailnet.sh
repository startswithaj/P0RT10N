#!/usr/bin/env bash
# Docker + REAL tailnet portion tier. Unlike the k8s tiers (secretless, on an
# in-cluster headscale), this one needs a real Tailscale OAuth client and a
# real tailnet — it is the only tier that can prove `tailscale serve` over
# HTTPS with real certs.
#
# Locally: reads .env (the same file `docker compose` uses).
# In CI: .env is absent, so the vars must already be in the environment.
#
#   ./integration-tests/run-docker-tailnet.sh          # build images + run
#   ./integration-tests/run-docker-tailnet.sh run      # run (images built)
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-all}"
MANAGER_IMAGE="${MANAGER_IMAGE:-p0rt1on-manager:it}"
INSTANCE_IMAGE="${P0RT1ON_INSTANCE_IMAGE:-p0rt1on-instance:it}"
CLIENT_IMAGE="${CLIENT_IMAGE:-p0rt1on-backup-client:it}"
# Fixed in the runtime (DOCKER_NETWORK) — instances always join this one.
NETWORK="p0rt1on-net"

# Local convenience only: CI injects these as secrets instead. `set -a` exports
# everything sourced, which is what the test reads.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# The instances the manager launches join this network by name.
docker network inspect "$NETWORK" >/dev/null 2>&1 ||
  docker network create "$NETWORK"

if [ "$MODE" = "all" ]; then
  # --target integration: the suites live only in that stage.
  docker build --target integration -t "$MANAGER_IMAGE" .
  docker build -t "$INSTANCE_IMAGE" instance
  docker build -t "$CLIENT_IMAGE" backup-client
fi

MANAGER_IMAGE="$MANAGER_IMAGE" \
  P0RT1ON_INSTANCE_IMAGE="$INSTANCE_IMAGE" \
  CLIENT_IMAGE="$CLIENT_IMAGE" \
  deno test --allow-read --allow-write --allow-env --allow-net --allow-run \
  integration-tests/Provisioning.docker.integration.test.ts
