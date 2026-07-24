#!/bin/sh
# p0rt1on instance health: healthy iff BOTH processes are good —
#   1. tailscaled is connected (BackendState == Running)
#   2. MinIO reports live
# Exits 0 (healthy) or 1 (unhealthy). Drives Docker's HEALTHCHECK, which the
# manager reads via `docker inspect .State.Health.Status`.
set -eu

MINIO_PORT="${MINIO_PORT:-9000}"

# Socket in the state subdir — writable for non-root (see entrypoint.sh).
TS_SOCKET="/var/lib/tailscale/state/tailscaled.sock"
# entrypoint.sh writes this when `tailscale serve` fails (e.g. no cert because
# MagicDNS/HTTPS is off) — the real reason behind an otherwise-live MinIO.
SERVE_FAILED="/var/lib/tailscale/state/serve-failed"

# Integration-test mode (see entrypoint.sh): MinIO-only, no tailnet check.
if [ "${TAILSCALE_DISABLED:-}" != "1" ]; then
  tailscale --socket="$TS_SOCKET" status --json 2>/dev/null |
    grep -q '"BackendState": *"Running"' ||
    { echo "tailscale not Running" >&2; exit 1; }
  # Surface a recorded serve failure as the reason (the manager reads this as
  # healthReason) instead of the misleading "minio not live" below.
  if [ -f "$SERVE_FAILED" ]; then
    cat "$SERVE_FAILED" >&2
    exit 1
  fi
fi

wget -q -O /dev/null "http://localhost:${MINIO_PORT}/minio/health/live" ||
  { echo "minio not live" >&2; exit 1; }

exit 0
