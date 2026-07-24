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
# TAILSCALE_DISABLED=1: MinIO-only mode for INTEGRATION TESTS (CI clusters
# have no tailnet). Never set in production — without tailscaled no friend
# can reach the instance.
TAILSCALE_DISABLED="${TAILSCALE_DISABLED:-}"
if [ "$TAILSCALE_DISABLED" != "1" ]; then
  : "${TAILSCALE_AUTHKEY:?TAILSCALE_AUTHKEY is required (the instance's serve auth key)}"
  : "${TAILSCALE_HOSTNAME:?TAILSCALE_HOSTNAME is required (this instance's tailnet hostname)}"
fi
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
export MINIO_ROOT_USER MINIO_ROOT_PASSWORD

TAILSCALE_TAG="${TAILSCALE_TAG:-}" # e.g. tag:p0rt1on-serve
# Alternative control plane, e.g. http://headscale:8080 (empty = Tailscale SaaS).
TAILSCALE_LOGIN_SERVER="${TAILSCALE_LOGIN_SERVER:-}"
# http = control planes without cert issuance (headscale); default https.
TAILSCALE_SERVE_MODE="${TAILSCALE_SERVE_MODE:-https}"
MINIO_PORT="${MINIO_PORT:-9000}"
DATA_DIR="${DATA_DIR:-/data}"
# MinIO's single-drive mode (SNSD) fully supports versioning + Object Lock
# (verified against this image 2026-07-07: locked bucket, inherited retention,
# WORM delete denial). The old ">=4 drives for lock" rule died with the legacy
# FS backend in 2022 — so one drive, no erasure parity overhead. Note: SNSD
# has zero parity, so bitrot is detected (checksums) but not self-healed; the
# real redundancy is the friend's client re-uploading.
MINIO_DRIVES="${MINIO_DRIVES:-$DATA_DIR}"
# tailscaled state + socket live in a SUBDIR of the state volume, created by
# whatever uid runs this script: tailscaled chmods its state dir to 0700, and
# under k8s PSA `restricted` (uid 1000, fsGroup) the volume MOUNT POINT is
# root-owned — chmod on it fails. A freshly created subdir is ours to chmod.
# The default socket dir /var/run/tailscale is root-only for the same reason.
# Same paths in healthcheck.sh.
TS_STATE_DIR="/var/lib/tailscale/state"
TS_SOCKET="$TS_STATE_DIR/tailscaled.sock"
mkdir -p "$TS_STATE_DIR"
# The healthcheck reads this to report a `tailscale serve` failure as the real
# reason; clear it each boot so a past failure never sticks.
SERVE_FAILED="$TS_STATE_DIR/serve-failed"
rm -f "$SERVE_FAILED"
# Pre-subdir instances (docker, root) kept state at the volume root — move it
# so they keep their node identity instead of re-enrolling.
if [ -f /var/lib/tailscale/tailscaled.state ] &&
  [ ! -f "$TS_STATE_DIR/tailscaled.state" ]; then
  mv /var/lib/tailscale/tailscaled.state "$TS_STATE_DIR/tailscaled.state"
fi

TAILSCALED_PID=""
MINIO_PID=""
shutdown() {
  log "shutting down"
  [ -n "$MINIO_PID" ] && kill -TERM "$MINIO_PID" 2>/dev/null || true
  [ -n "$TAILSCALED_PID" ] && {
    tailscale --socket="$TS_SOCKET" down >/dev/null 2>&1 || true
    kill "$TAILSCALED_PID" 2>/dev/null || true
  }
}
trap shutdown TERM INT

# --- tailscaled --------------------------------------------------------------
if [ "$TAILSCALE_DISABLED" = "1" ]; then
  log "TAILSCALE_DISABLED=1 — skipping tailscaled/serve (integration tests only)"
else
log "starting tailscaled (userspace networking)"
# --statedir (a var root), NOT just --state (a file): `tailscale serve --https`
# stores its issued cert under the state dir's var root. tailscaled only derives
# a var root from --statedir, or from --state at the WELL-KNOWN default path;
# our non-default subdir (the non-root/fsGroup fix) left it with none, so cert
# issuance failed ("no TailscaleVarRoot") and serve returned TLS "internal
# error" to every friend. --statedir keeps the state file at
# $TS_STATE_DIR/tailscaled.state (what the migration above produces) AND gives
# serve a place for its cert.
tailscaled \
  --tun=userspace-networking \
  --statedir="$TS_STATE_DIR" \
  --socket="$TS_SOCKET" \
  >/tmp/tailscaled.log 2>&1 &
TAILSCALED_PID=$!

# `tailscale up` is idempotent: a persisted state volume re-authenticates without
# re-redeeming the single-use key.
extra=""
[ -n "$TAILSCALE_TAG" ] && extra="--advertise-tags=$TAILSCALE_TAG"
[ -n "$TAILSCALE_LOGIN_SERVER" ] && extra="$extra --login-server=$TAILSCALE_LOGIN_SERVER"
log "joining tailnet as '$TAILSCALE_HOSTNAME'"
# shellcheck disable=SC2086
tailscale --socket="$TS_SOCKET" up \
  --authkey="$TAILSCALE_AUTHKEY" --hostname="$TAILSCALE_HOSTNAME" $extra

# Wait for the backend to report Running (up to ~30s).
i=0
until tailscale --socket="$TS_SOCKET" status --json 2>/dev/null |
  grep -q '"BackendState": *"Running"'; do
  i=$((i + 1))
  [ "$i" -ge 30 ] && die "tailscale did not come up (see /tmp/tailscaled.log)"
  sleep 1
done
log "tailnet is up"

# --- serve MinIO over the tailnet (https:443 -> localhost:MINIO_PORT) ---------
# On failure we do NOT die: dying here exits before MinIO starts, so the
# healthcheck would report a misleading "minio not live". Instead we record the
# real reason for the healthcheck to surface (the manager reads it as
# healthReason). HTTPS serve needs a cert, which Tailscale only issues when
# MagicDNS + HTTPS certificates are enabled on the tailnet.
log "publishing MinIO via tailscale serve (${TAILSCALE_SERVE_MODE})"
if [ "$TAILSCALE_SERVE_MODE" = "http" ]; then
  # No cert issuance on this control plane (headscale) — serve plain HTTP :80.
  # The tailnet itself (WireGuard) is the encryption on this path.
  serve_port="--http=80"
else
  serve_port="--https=443"
fi
serve_rc=0
# timeout guards against serve blocking on a cert that will never issue.
serve_out=$(timeout 30 tailscale --socket="$TS_SOCKET" serve --bg "$serve_port" \
  "http://localhost:${MINIO_PORT}" 2>&1) || serve_rc=$?
if [ "$serve_rc" -ne 0 ]; then
  printf '%s\n' \
    "tailscale serve (${TAILSCALE_SERVE_MODE}) failed (rc=${serve_rc}): ${serve_out}" \
    "enable MagicDNS + HTTPS certificates on the tailnet (admin console -> DNS)" \
    > "$SERVE_FAILED"
  log "ERROR: tailscale serve failed (rc=${serve_rc}): ${serve_out}"
fi
fi

# --- MinIO -------------------------------------------------------------------
log "starting minio on :${MINIO_PORT} (drives: ${MINIO_DRIVES})"
# shellcheck disable=SC2086
minio server $MINIO_DRIVES --address ":${MINIO_PORT}" &
MINIO_PID=$!

wait "$MINIO_PID"
