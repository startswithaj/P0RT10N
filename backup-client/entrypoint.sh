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

[ -d "$BACKUP_PATH" ] || die "BACKUP_PATH '$BACKUP_PATH' is not a directory — did you mount your data into the container?"

# Kopia's S3 --endpoint wants host[:port], not a full URL, matching the manager's kopiaQuickstart which also strips the scheme.
# If the endpoint was plain http, disable TLS for the Kopia client too.
S3_HOST=$(printf '%s' "$S3_ENDPOINT" | sed -e 's#^https://##' -e 's#^http://##' -e 's#/$##')
KOPIA_TLS_ARGS=""
case "$S3_ENDPOINT" in
  http://*) KOPIA_TLS_ARGS="--disable-tls" ;;
esac

TAILSCALED_PID=""
# Set only when VERIFY_RESTORE=1 runs a restore; cleaned up here so it's
# removed on every exit path (success, die, or signal), not just the happy one.
RESTORE_DIR=""
cleanup() {
  if [ -n "$RESTORE_DIR" ]; then
    rm -rf "$RESTORE_DIR"
  fi
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

# VERIFY_RESTORE=1 (default off) proves the snapshot just taken is actually
# recoverable, instead of trusting Kopia's exit code alone. This has to run
# now, before `cleanup` (trap EXIT) tears down Tailscale below — once that
# fires there is no tailnet left to reach the repository.
if [ "$STATUS" -eq 0 ] && [ "${VERIFY_RESTORE:-}" = "1" ]; then
  # kopia lists snapshots oldest-first, so the last "id" in --json output is
  # the one just created above.
  SNAPSHOT_ID=$(kopia snapshot list "$BACKUP_PATH" --json |
    grep -o '"id" *: *"[^"]*"' | tail -1 | sed -e 's/.*"\([^"]*\)"$/\1/')
  [ -n "$SNAPSHOT_ID" ] || die "VERIFY_RESTORE: could not determine latest snapshot ID"

  # Percent of file content actually read back per run (0 disables content
  # reads entirely and only walks the object graph — checked against this
  # exact kopia build to miss corrupted blobs completely, so treat 0 as "no
  # real check"). 100 is the only setting that catches corruption in a
  # single run; a lower value reads less data (and less tailnet bandwidth)
  # per run at the cost of a corrupt blob taking longer to be noticed, since
  # kopia samples a different subset each time. Defaults to 100 so
  # correctness is what you get unless you deliberately trade it away for a
  # large repo on a metered/slow link.
  VERIFY_RESTORE_PERCENT="${VERIFY_RESTORE_PERCENT:-100}"
  log "VERIFY_RESTORE=1 — verifying the snapshot is intact and retrievable (${VERIFY_RESTORE_PERCENT}% content read)"
  # `snapshot verify` reads objects back out of the REPOSITORY and checks
  # they decode; it never looks at BACKUP_PATH, so it can't be fooled by a
  # live workload writing new files after the snapshot was taken.
  kopia snapshot verify --verify-files-percent="$VERIFY_RESTORE_PERCENT" "$SNAPSHOT_ID" ||
    die "VERIFY_RESTORE: snapshot failed integrity verification (contents unreadable from the repository)"
  log "VERIFY_RESTORE: snapshot verified intact and retrievable"

  # VERIFY_RESTORE_DIFF=1 additionally restores the snapshot and diffs it
  # byte-for-byte against BACKUP_PATH. Unlike the check above, this DOES
  # compare against the live source, so it only belongs on data known to be
  # quiescent for the duration of the backup (a stopped DB, a seeded test
  # fixture) — on live data it will false-positive the moment something else
  # writes a file mid-run. Off by default for that reason.
  if [ "${VERIFY_RESTORE_DIFF:-}" = "1" ]; then
    log "VERIFY_RESTORE_DIFF=1 — restoring the snapshot to diff against BACKUP_PATH"
    RESTORE_DIR=$(mktemp -d)
    kopia restore "$SNAPSHOT_ID" "$RESTORE_DIR" >/dev/null ||
      die "VERIFY_RESTORE_DIFF: kopia restore failed"
    # -q (names only): BACKUP_PATH can hold arbitrary friend data, so a
    # mismatch must never dump file contents into container logs.
    if ! DIFF_OUT=$(diff -rq "$BACKUP_PATH" "$RESTORE_DIR" 2>&1); then
      log "VERIFY_RESTORE_DIFF: mismatch between $BACKUP_PATH and the restored snapshot:"
      echo "$DIFF_OUT" >&2
      die "VERIFY_RESTORE_DIFF: restored content does not match $BACKUP_PATH"
    fi
    # VERIFY_RESTORE_VERBOSE=1 additionally logs a checksum per restored
    # file, so a caller (the e2e suite) can independently confirm exact
    # bytes without trusting the diff/die logic above. Off by default: a
    # real friend's directory listing is itself sensitive metadata this
    # product otherwise never puts in logs.
    if [ "${VERIFY_RESTORE_VERBOSE:-}" = "1" ]; then
      find "$RESTORE_DIR" -type f | sort | while read -r f; do
        log "VERIFY_RESTORE_DIFF: sha256(${f#"$RESTORE_DIR"/})=$(sha256sum "$f" | cut -d' ' -f1)"
      done
    fi
    FILE_COUNT=$(find "$RESTORE_DIR" -type f | wc -l | tr -d ' ')
    BYTE_COUNT=$(find "$RESTORE_DIR" -type f -exec cat {} + 2>/dev/null | wc -c | tr -d ' ')
    log "VERIFY_RESTORE_DIFF: restored content matches source ($FILE_COUNT files, $BYTE_COUNT bytes)"
  fi
fi

# Object Lock holds objects for the retention window, so maintenance must run within that window to reclaim space; it is best-effort and never fails the run.
kopia maintenance run >/dev/null 2>&1 || log "maintenance skipped/failed (non-fatal)"

log "done (snapshot exit=$STATUS)"
exit "$STATUS"
