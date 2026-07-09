#!/bin/sh
# p0rt1on backup-client — one-shot backup runner.
#
# Flow: validate env -> bring up Tailscale (userspace) -> route Kopia's S3 traffic
# through the tailnet -> connect (or create) the Kopia repo -> snapshot the mounted
# directory -> tear down. Exits with the snapshot's status so cron / k8s sees
# pass/fail. Everything is configured by env vars (see .env.example).
set -eu

log() { echo "[p0rt1on-backup] $*"; }
die() { echo "[p0rt1on-backup] ERROR: $*" >&2; exit 1; }

# --- 1. Validate env ---------------------------------------------------------
# Required regardless of mode.
: "${S3_ENDPOINT:?S3_ENDPOINT is required (your bucket endpoint from the bundle)}"
: "${S3_BUCKET:?S3_BUCKET is required (your bucket name from the bundle)}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required (from the bundle)}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required (from the bundle)}"
: "${KOPIA_PASSWORD:?KOPIA_PASSWORD is required (YOUR encryption password — keep it safe, it is never sent to the server)}"
: "${BACKUP_PATH:?BACKUP_PATH is required (path inside the container to back up, e.g. /data)}"

# Optional, with defaults.
S3_REGION="${S3_REGION:-us-east-1}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
# Defaults to the bucket name so every cron run shares one stable identity — both
# as the tailnet node name and as the Kopia snapshot source (see overrides below).
# Without this each fresh container gets a random hostname and snapshot history
# fragments across sources.
TAILSCALE_HOSTNAME="${TAILSCALE_HOSTNAME:-$S3_BUCKET}"
TAILSCALE_EXTRA_ARGS="${TAILSCALE_EXTRA_ARGS:-}"
# Alternative control plane, e.g. http://headscale:8080 (empty = Tailscale SaaS).
TAILSCALE_LOGIN_SERVER="${TAILSCALE_LOGIN_SERVER:-}"
# SKIP_TAILSCALE=1 talks to S3_ENDPOINT directly (local testing without a tailnet).
SKIP_TAILSCALE="${SKIP_TAILSCALE:-}"

[ -d "$BACKUP_PATH" ] || die "BACKUP_PATH '$BACKUP_PATH' is not a directory — did you mount your data into the container?"

# Kopia's S3 --endpoint wants host[:port], not a full URL (same as the manager's
# kopiaQuickstart, which strips the scheme). Derive the host; if the endpoint was
# plain http, disable TLS.
S3_HOST=$(printf '%s' "$S3_ENDPOINT" | sed -e 's#^https://##' -e 's#^http://##' -e 's#/$##')
KOPIA_TLS_ARGS=""
case "$S3_ENDPOINT" in
  http://*) KOPIA_TLS_ARGS="--disable-tls" ;;
esac

# --- 2 & 3. Bring up Tailscale (userspace) -----------------------------------
TAILSCALED_PID=""
cleanup() {
  if [ -n "$TAILSCALED_PID" ]; then
    log "tearing down Tailscale"
    tailscale down >/dev/null 2>&1 || true
    kill "$TAILSCALED_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if [ "$SKIP_TAILSCALE" = "1" ]; then
  log "SKIP_TAILSCALE=1 — connecting to $S3_ENDPOINT directly (no tailnet)"
else
  : "${TAILSCALE_AUTHKEY:?TAILSCALE_AUTHKEY is required (your Tailscale auth key from the bundle); set SKIP_TAILSCALE=1 to bypass for local testing}"

  log "starting tailscaled (userspace networking)"
  tailscaled \
    --tun=userspace-networking \
    --socks5-server=localhost:1055 \
    --outbound-http-proxy-listen=localhost:1055 \
    --state=/var/lib/tailscale/tailscaled.state \
    >/tmp/tailscaled.log 2>&1 &
  TAILSCALED_PID=$!

  # `tailscale up` is idempotent: if a persisted state volume already authenticated
  # this node, it comes up without re-redeeming the (single-use) key.
  log "joining tailnet as '$TAILSCALE_HOSTNAME'"
  # shellcheck disable=SC2086
  tailscale up \
    --authkey="$TAILSCALE_AUTHKEY" \
    --hostname="$TAILSCALE_HOSTNAME" \
    --accept-routes \
    ${TAILSCALE_LOGIN_SERVER:+--login-server="$TAILSCALE_LOGIN_SERVER"} \
    $TAILSCALE_EXTRA_ARGS

  # Wait for the backend to report Running (up to ~30s).
  i=0
  until tailscale status --json 2>/dev/null | grep -q '"BackendState": *"Running"'; do
    i=$((i + 1))
    [ "$i" -ge 30 ] && die "Tailscale did not come up in time (see /tmp/tailscaled.log)"
    sleep 1
  done
  log "tailnet is up"

  # Route Kopia's S3 client through tailscaled so the MagicDNS endpoint resolves
  # and connects over the tailnet. The SOCKS5 proxy does remote DNS resolution.
  export HTTPS_PROXY="http://localhost:1055"
  export HTTP_PROXY="http://localhost:1055"
  export ALL_PROXY="socks5://localhost:1055"
fi

# --- 4 & 5. Connect or create the Kopia repo ---------------------------------
# KOPIA_PASSWORD is read from the environment by kopia itself — never passed on the
# command line, never logged.
KOPIA_CACHE_ARGS=""
if [ -n "${KOPIA_CACHE_DIRECTORY:-}" ]; then
  KOPIA_CACHE_ARGS="--cache-directory=$KOPIA_CACHE_DIRECTORY"
fi

# shellcheck disable=SC2086
if kopia repository connect s3 \
  --bucket="$S3_BUCKET" \
  --endpoint="$S3_HOST" \
  --region="$S3_REGION" \
  --access-key="$S3_ACCESS_KEY_ID" \
  --secret-access-key="$S3_SECRET_ACCESS_KEY" \
  --override-username=p0rt1on \
  --override-hostname="$TAILSCALE_HOSTNAME" \
  $KOPIA_TLS_ARGS $KOPIA_CACHE_ARGS >/dev/null 2>&1; then
  log "connected to existing Kopia repository"
else
  log "no repository found — creating one (GOVERNANCE retention ${RETENTION_DAYS}d)"
  # shellcheck disable=SC2086
  kopia repository create s3 \
    --bucket="$S3_BUCKET" \
    --endpoint="$S3_HOST" \
    --region="$S3_REGION" \
    --access-key="$S3_ACCESS_KEY_ID" \
    --secret-access-key="$S3_SECRET_ACCESS_KEY" \
    --retention-mode=GOVERNANCE \
    --retention-period="${RETENTION_DAYS}d" \
    --override-username=p0rt1on \
    --override-hostname="$TAILSCALE_HOSTNAME" \
    $KOPIA_TLS_ARGS $KOPIA_CACHE_ARGS
fi

# --- 6. Snapshot -------------------------------------------------------------
# Capture the status without aborting (set -e) so maintenance still runs and we
# exit with the snapshot's real result.
log "backing up $BACKUP_PATH"
set +e
kopia snapshot create "$BACKUP_PATH"
STATUS=$?
set -e

# --- 7. Maintenance (best-effort) --------------------------------------------
# Object Lock holds objects for the retention window; full maintenance must run
# within that window to reclaim space. Best-effort: never fail the run on it.
kopia maintenance run >/dev/null 2>&1 || log "maintenance skipped/failed (non-fatal)"

log "done (snapshot exit=$STATUS)"
exit "$STATUS"
