#!/bin/sh
# Healthy requires tailscaled connected (BackendState Running) AND MinIO live; exits 0 or 1 accordingly.
# Drives Docker's HEALTHCHECK, which the manager reads via `docker inspect .State.Health.Status`.
set -eu

MINIO_PORT="${MINIO_PORT:-9000}"

# The socket lives in the state subdir because it must be writable for non-root; see entrypoint.sh.
TS_SOCKET="/var/lib/tailscale/state/tailscaled.sock"
# entrypoint.sh writes this file when tailscale serve fails, e.g. no cert because MagicDNS/HTTPS is off, giving the real reason behind an otherwise-live MinIO.
SERVE_FAILED="/var/lib/tailscale/state/serve-failed"

# Integration-test mode (see entrypoint.sh): MinIO-only, no tailnet check.
if [ "${TAILSCALE_DISABLED:-}" != "1" ]; then
  tailscale --socket="$TS_SOCKET" status --json 2>/dev/null |
    grep -q '"BackendState": *"Running"' ||
    { echo "tailscale not Running" >&2; exit 1; }
  # A recorded serve failure is surfaced as the reason instead of the misleading "minio not live" below; the manager reads this as healthReason.
  if [ -f "$SERVE_FAILED" ]; then
    cat "$SERVE_FAILED" >&2
    exit 1
  fi
fi

wget -q -O /dev/null "http://localhost:${MINIO_PORT}/minio/health/live" ||
  { echo "minio not live" >&2; exit 1; }

exit 0
