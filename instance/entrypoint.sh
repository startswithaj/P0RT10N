#!/bin/sh
# The script waits on minio (tini is PID 1, reaping/forwarding signals); the container stops when minio exits.
set -eu

log() { echo "[p0rt1on-instance] $*"; }
die() {
  echo "[p0rt1on-instance] ERROR: $*" >&2
  exit 1
}

# TAILSCALE_DISABLED=1: MinIO-only mode for integration tests (CI has no tailnet).
# Never set in production, because without tailscaled friends cannot reach the instance.
TAILSCALE_DISABLED="${TAILSCALE_DISABLED:-}"
if [ "$TAILSCALE_DISABLED" != "1" ]; then
  : "${TAILSCALE_AUTHKEY:?TAILSCALE_AUTHKEY is required (the instance's serve auth key)}"
  : "${TAILSCALE_HOSTNAME:?TAILSCALE_HOSTNAME is required (this instance's tailnet hostname)}"
fi
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
export MINIO_ROOT_USER MINIO_ROOT_PASSWORD

TAILSCALE_LOGIN_SERVER="${TAILSCALE_LOGIN_SERVER:-}"
# HTTP mode is for control planes without cert issuance, like headscale; default is HTTPS.
TAILSCALE_SERVE_MODE="${TAILSCALE_SERVE_MODE:-https}"
MINIO_PORT="${MINIO_PORT:-9000}"
DATA_DIR="${DATA_DIR:-/data}"
# Single-drive mode (SNSD) fully supports Object Lock and versioning; the old >=4-drives requirement died with the legacy FS backend in 2022.
# SNSD has no parity, so bitrot is detected but not self-healed; redundancy relies on the friend's client re-uploading.
MINIO_DRIVES="${MINIO_DRIVES:-$DATA_DIR}"
# A fresh subdir under the state volume is created here because tailscaled chmods it to 0700, and under k8s PSA restricted the volume mount point is root-owned so chmod on it fails.
# healthcheck.sh uses the same paths, so keep them in sync.
TS_STATE_DIR="/var/lib/tailscale/state"
TS_SOCKET="$TS_STATE_DIR/tailscaled.sock"
mkdir -p "$TS_STATE_DIR"
# healthcheck.sh reads this file to report a `tailscale serve` failure as the real reason; cleared each boot so a stale failure never sticks.
SERVE_FAILED="$TS_STATE_DIR/serve-failed"
rm -f "$SERVE_FAILED"
# Older instances (pre-subdir, docker/root) kept state at the volume root; migrate it here so they keep their tailnet node identity instead of re-enrolling.
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

if [ "$TAILSCALE_DISABLED" = "1" ]; then
  log "TAILSCALE_DISABLED=1 — skipping tailscaled/serve (integration tests only)"
else
log "starting tailscaled (userspace networking)"
# --statedir (not --state) is required: tailscale serve's HTTPS cert needs a var root, which tailscaled only derives from --statedir or the default --state path.
# Our non-default state subdir left it without one, so cert issuance failed and serve returned TLS errors to every friend.
tailscaled \
  --tun=userspace-networking \
  --statedir="$TS_STATE_DIR" \
  --socket="$TS_SOCKET" \
  >/tmp/tailscaled.log 2>&1 &
TAILSCALED_PID=$!

# `tailscale up` is idempotent, so a persisted state volume re-authenticates without re-redeeming the single-use key.
# The auth key already carries the tag; --advertise-tags is omitted because headscale 0.29+ rejects a tagged key that also advertises tags.
extra=""
[ -n "$TAILSCALE_LOGIN_SERVER" ] && extra="--login-server=$TAILSCALE_LOGIN_SERVER"
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

log "publishing MinIO via tailscale serve (${TAILSCALE_SERVE_MODE})"
# Serve failures don't stop the script: exiting here would prevent MinIO from starting, so healthcheck would misreport "minio not live" instead of the real cause.
# The real reason is written to $SERVE_FAILED for healthcheck.sh to surface; HTTPS serve requires MagicDNS and HTTPS certificates enabled on the tailnet.
if [ "$TAILSCALE_SERVE_MODE" = "http" ]; then
  # Headscale forwards raw TCP on :80 instead of HTTP-proxying because serve's HTTP mode 404s bare-IP requests and needs Host-header routing; the tailnet IP endpoint still works with MagicDNS off.
  # WireGuard still encrypts this path even though no cert is issued.
  serve_port="--tcp=80"
  serve_target="tcp://localhost:${MINIO_PORT}"
else
  serve_port="--https=443"
  serve_target="http://localhost:${MINIO_PORT}"
fi
serve_rc=0
# Timeout guards against serve blocking on a cert that will never issue.
serve_out=$(timeout 30 tailscale --socket="$TS_SOCKET" serve --bg "$serve_port" \
  "$serve_target" 2>&1) || serve_rc=$?
if [ "$serve_rc" -ne 0 ]; then
  printf '%s\n' \
    "tailscale serve (${TAILSCALE_SERVE_MODE}) failed (rc=${serve_rc}): ${serve_out}" \
    "enable MagicDNS + HTTPS certificates on the tailnet (admin console -> DNS)" \
    > "$SERVE_FAILED"
  log "ERROR: tailscale serve failed (rc=${serve_rc}): ${serve_out}"
fi

# serve --bg returns before any cert exists; the first friend would otherwise
# pay ACME registration + DNS-01 inside its 10s TLS handshake timeout. Fetch now.
if [ "$TAILSCALE_SERVE_MODE" != "http" ] && [ ! -f "$SERVE_FAILED" ]; then
  fqdn=$(tailscale --socket="$TS_SOCKET" status --json |
    sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -n 1)
  log "fetching HTTPS cert for ${fqdn}"
  cert_rc=0
  cert_out=$(timeout 120 tailscale --socket="$TS_SOCKET" cert "$fqdn" 2>&1) || cert_rc=$?
  if [ "$cert_rc" -ne 0 ]; then
    printf '%s\n' \
      "tailscale cert ${fqdn} failed (rc=${cert_rc}): ${cert_out}" \
      "friends will hit TLS handshake timeouts until a cert is issued" \
      > "$SERVE_FAILED"
    log "ERROR: tailscale cert failed (rc=${cert_rc}): ${cert_out}"
  fi
fi
fi

log "starting minio on :${MINIO_PORT} (drives: ${MINIO_DRIVES})"
# shellcheck disable=SC2086
minio server $MINIO_DRIVES --address ":${MINIO_PORT}" &
MINIO_PID=$!

wait "$MINIO_PID"
