#!/bin/sh
# p0rt1on instance health: healthy iff BOTH processes are good —
#   1. tailscaled is connected (BackendState == Running)
#   2. MinIO reports live
# Exits 0 (healthy) or 1 (unhealthy). Drives Docker's HEALTHCHECK, which the
# manager reads via `docker inspect .State.Health.Status`.
set -eu

MINIO_PORT="${MINIO_PORT:-9000}"

# Integration-test mode (see entrypoint.sh): MinIO-only, no tailnet check.
if [ "${TAILSCALE_DISABLED:-}" != "1" ]; then
  tailscale status --json 2>/dev/null | grep -q '"BackendState": *"Running"' ||
    { echo "tailscale not Running" >&2; exit 1; }
fi

wget -q -O /dev/null "http://localhost:${MINIO_PORT}/minio/health/live" ||
  { echo "minio not live" >&2; exit 1; }

exit 0
