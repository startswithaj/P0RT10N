#!/bin/sh
# Exits with the snapshot's status so cron / k8s sees pass/fail.
set -eu

log() { echo "[p0rt1on-backup] $*"; }
die() { echo "[p0rt1on-backup] ERROR: $*" >&2; exit 1; }

: "${S3_ENDPOINT:?S3_ENDPOINT is required (your bucket endpoint from the bundle)}"
: "${S3_BUCKET:?S3_BUCKET is required (your bucket name from the bundle)}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required (from the bundle)}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required (from the bundle)}"
: "${KOPIA_PASSWORD:?KOPIA_PASSWORD is required (YOUR encryption password — keep it safe, it is never sent to the server)}"
: "${BACKUP_PATH:?BACKUP_PATH is required (path inside the container to back up, e.g. /data)}"

RETENTION_DAYS="${RETENTION_DAYS:-30}"
# Defaults to the bucket name so every cron run shares one stable identity, both as the tailnet node name and the Kopia snapshot source.
# Without this default each fresh container gets a random hostname and snapshot history fragments across sources.
TAILSCALE_HOSTNAME="${TAILSCALE_HOSTNAME:-$S3_BUCKET}"
TAILSCALE_EXTRA_ARGS="${TAILSCALE_EXTRA_ARGS:-}"
TAILSCALE_LOGIN_SERVER="${TAILSCALE_LOGIN_SERVER:-}"
# SKIP_TAILSCALE=1 talks to S3_ENDPOINT directly (local testing without a tailnet).
SKIP_TAILSCALE="${SKIP_TAILSCALE:-}"

# Completion hooks. Both are optional, both fire on success AND failure — a
# backup that silently stops running is the case worth being told about — and
# neither can fail the run, since a notifier being down is not a backup failure.
BACKUP_HOOK_URL="${BACKUP_HOOK_URL:-}"
BACKUP_HOOK_BODY="${BACKUP_HOOK_BODY:-}"
HOOK_SCRIPT="${BACKUP_HOOK_SCRIPT:-/hooks/on-complete}"
DEFAULT_HOOK_BODY='{"status":"{status}","exit_code":{exit_code},"bucket":"{bucket}","host":"{host}","duration_s":{duration_s}}'

[ -d "$BACKUP_PATH" ] || die "BACKUP_PATH '$BACKUP_PATH' is not a directory — did you mount your data into the container?"

# Kopia's S3 --endpoint wants host[:port], not a full URL, matching the manager's kopiaQuickstart which also strips the scheme.
# If the endpoint was plain http, disable TLS for the Kopia client too.
S3_HOST=$(printf '%s' "$S3_ENDPOINT" | sed -e 's#^https://##' -e 's#^http://##' -e 's#/$##')
KOPIA_TLS_ARGS=""
case "$S3_ENDPOINT" in
  http://*) KOPIA_TLS_ARGS="--disable-tls" ;;
esac

STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START_S=$(date +%s)
HOOKS_RAN=""

# Substitutes {placeholders} in a hook body. Values are DNS labels, a status
# word and integers, so none can contain the `|` delimiter or break the JSON.
render_hook_body() {
  printf '%s' "$1" |
    sed -e "s|{status}|$2|g" \
      -e "s|{exit_code}|$3|g" \
      -e "s|{bucket}|$S3_BUCKET|g" \
      -e "s|{host}|$TAILSCALE_HOSTNAME|g" \
      -e "s|{duration_s}|$4|g"
}

# Called from the EXIT trap, so it fires however the run ends — including a
# failure to reach the repository at all, which never gets as far as a
# snapshot and is the silent failure most worth being told about.
notify() {
  code=$1
  [ -z "$HOOKS_RAN" ] || return 0
  HOOKS_RAN=1
  if [ "$code" -eq 0 ]; then hook_status=ok; else hook_status=failed; fi
  duration=$(( $(date +%s) - START_S ))

  if [ -n "$BACKUP_HOOK_URL" ]; then
    log "posting completion hook ($hook_status)"
    # The URL may carry a token (Telegram puts one in the path), so it is never
    # logged — only whether the call worked.
    wget -qO- --timeout=10 --header="Content-Type: application/json" \
      --post-data="$(
        render_hook_body "${BACKUP_HOOK_BODY:-$DEFAULT_HOOK_BODY}" \
          "$hook_status" "$code" "$duration"
      )" \
      "$BACKUP_HOOK_URL" >/dev/null 2>&1 ||
      log "completion hook URL failed (non-fatal)"
  fi

  if [ -x "$HOOK_SCRIPT" ]; then
    log "running $HOOK_SCRIPT ($hook_status)"
    # Anything named HOOK_* is forwarded, so a hook can hold its own
    # credentials — a bot token, an ntfy password — without the blanket scrub
    # below also starving it of them. Names are matched strictly and values
    # read by name, so a value with spaces or `=` in it survives intact.
    set --
    for hook_name in $(env | sed -n 's/^\(HOOK_[A-Za-z0-9_]*\)=.*/\1/p'); do
      eval "hook_value=\${$hook_name}"
      set -- "$@" "$hook_name=$hook_value"
    done
    # env -i so a hook never inherits KOPIA_PASSWORD, the S3 secret or the auth
    # key: a notifier copied off the internet must not be handed the keys to
    # the repository it is reporting on.
    env -i PATH="$PATH" \
      BACKUP_STATUS="$hook_status" \
      BACKUP_EXIT_CODE="$code" \
      BACKUP_BUCKET="$S3_BUCKET" \
      BACKUP_HOST="$TAILSCALE_HOSTNAME" \
      BACKUP_PATH="$BACKUP_PATH" \
      BACKUP_STARTED_AT="$STARTED_AT" \
      BACKUP_DURATION_S="$duration" \
      "$@" \
      "$HOOK_SCRIPT" || log "completion hook script failed (non-fatal)"
  fi
}

TAILSCALED_PID=""
cleanup() {
  rc=$?
  # Before the tailnet goes away, since a hook may need to reach the network.
  notify "$rc"
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

  # `tailscale up` is idempotent: a node with a persisted, already-authenticated state volume comes up without re-redeeming the single-use key.
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

  # Kopia's S3 client is routed through tailscaled's SOCKS5 proxy so the MagicDNS endpoint resolves and connects over the tailnet; the proxy does remote DNS resolution.
  export HTTPS_PROXY="http://localhost:1055"
  export HTTP_PROXY="http://localhost:1055"
  export ALL_PROXY="socks5://localhost:1055"
fi

# KOPIA_PASSWORD is read from the environment by kopia itself; it is never passed on the command line or logged.
KOPIA_CACHE_ARGS=""
if [ -n "${KOPIA_CACHE_DIRECTORY:-}" ]; then
  KOPIA_CACHE_ARGS="--cache-directory=$KOPIA_CACHE_DIRECTORY"
fi

# shellcheck disable=SC2086
if kopia repository connect s3 \
  --bucket="$S3_BUCKET" \
  --endpoint="$S3_HOST" \
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
    --access-key="$S3_ACCESS_KEY_ID" \
    --secret-access-key="$S3_SECRET_ACCESS_KEY" \
    --retention-mode=GOVERNANCE \
    --retention-period="${RETENTION_DAYS}d" \
    --override-username=p0rt1on \
    --override-hostname="$TAILSCALE_HOSTNAME" \
    $KOPIA_TLS_ARGS $KOPIA_CACHE_ARGS
fi

log "backing up $BACKUP_PATH"
# set +e/-e brackets the snapshot command so a failure doesn't abort the script; STATUS captures the real exit code so maintenance still runs and the run exits with the true result.
set +e
kopia snapshot create "$BACKUP_PATH"
STATUS=$?
set -e

# Object Lock holds objects for the retention window, so maintenance must run within that window to reclaim space; it is best-effort and never fails the run.
kopia maintenance run >/dev/null 2>&1 || log "maintenance skipped/failed (non-fatal)"

log "done (snapshot exit=$STATUS)"
exit "$STATUS"
