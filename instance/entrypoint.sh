#!/bin/sh
# p0rt1on instance — long-running MinIO + tailscaled in one container.
#
# Flow: start tailscaled (userspace) -> join the tailnet (tagged) -> `tailscale
# serve` MinIO over HTTPS -> run MinIO. tailscaled + minio run as background
# children; the script waits on minio (tini is PID 1, reaping + forwarding
# signals). If minio exits, the container stops.
set -eu

log() { echo "[p0rt1on-instance] $*"; }
die() {
  echo "[p0rt1on-instance] ERROR: $*" >&2
  exit 1
}

# --- env ---------------------------------------------------------------------
: "${TAILSCALE_AUTHKEY:?TAILSCALE_AUTHKEY is required (the instance's serve auth key)}"
: "${TAILSCALE_HOSTNAME:?TAILSCALE_HOSTNAME is required (this instance's tailnet hostname)}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
export MINIO_ROOT_USER MINIO_ROOT_PASSWORD

TAILSCALE_TAG="${TAILSCALE_TAG:-}" # e.g. tag:p0rt1on-serve
MINIO_PORT="${MINIO_PORT:-9000}"
DATA_DIR="${DATA_DIR:-/data}"
# MinIO's single-drive mode (SNSD) fully supports versioning + Object Lock
# (verified against this image 2026-07-07: locked bucket, inherited retention,
# WORM delete denial). The old ">=4 drives for lock" rule died with the legacy
# FS backend in 2022 — so one drive, no erasure parity overhead. Note: SNSD
# has zero parity, so bitrot is detected (checksums) but not self-healed; the
# real redundancy is the friend's client re-uploading.
MINIO_DRIVES="${MINIO_DRIVES:-$DATA_DIR}"

TAILSCALED_PID=""
MINIO_PID=""
shutdown() {
  log "shutting down"
  [ -n "$MINIO_PID" ] && kill -TERM "$MINIO_PID" 2>/dev/null || true
  [ -n "$TAILSCALED_PID" ] && {
    tailscale down >/dev/null 2>&1 || true
    kill "$TAILSCALED_PID" 2>/dev/null || true
  }
}
trap shutdown TERM INT

# --- tailscaled --------------------------------------------------------------
log "starting tailscaled (userspace networking)"
tailscaled \
  --tun=userspace-networking \
  --state=/var/lib/tailscale/tailscaled.state \
  >/tmp/tailscaled.log 2>&1 &
TAILSCALED_PID=$!

# `tailscale up` is idempotent: a persisted state volume re-authenticates without
# re-redeeming the single-use key.
extra=""
[ -n "$TAILSCALE_TAG" ] && extra="--advertise-tags=$TAILSCALE_TAG"
log "joining tailnet as '$TAILSCALE_HOSTNAME'"
# shellcheck disable=SC2086
tailscale up --authkey="$TAILSCALE_AUTHKEY" --hostname="$TAILSCALE_HOSTNAME" $extra

# Wait for the backend to report Running (up to ~30s).
i=0
until tailscale status --json 2>/dev/null | grep -q '"BackendState": *"Running"'; do
  i=$((i + 1))
  [ "$i" -ge 30 ] && die "tailscale did not come up (see /tmp/tailscaled.log)"
  sleep 1
done
log "tailnet is up"

# --- serve MinIO over the tailnet (https:443 -> localhost:MINIO_PORT) ---------
log "publishing MinIO via tailscale serve"
tailscale serve --bg --https=443 "http://localhost:${MINIO_PORT}"

# --- MinIO -------------------------------------------------------------------
log "starting minio on :${MINIO_PORT} (drives: ${MINIO_DRIVES})"
# shellcheck disable=SC2086
minio server $MINIO_DRIVES --address ":${MINIO_PORT}" &
MINIO_PID=$!

wait "$MINIO_PID"
