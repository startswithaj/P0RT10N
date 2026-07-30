#!/usr/bin/env bash
# Standalone smoke-test of the p0rt1on instance image: build it, boot ONE
# container with a throwaway data dir + a real serve auth key, wait for the
# HEALTHCHECK to report healthy, confirm MinIO is live, then tear it down.
#
# Usage:
#   TAILSCALE_AUTHKEY=tskey-auth-... ./instance/boot-check.sh
#
# Mint TAILSCALE_AUTHKEY from the admin console tagged `tag:p0rt1on-serve`. Use an
# EPHEMERAL key so the test node auto-removes from the tailnet when it stops.
# Requires: Docker, and a tailnet with MagicDNS + HTTPS certificates enabled
# (tailscale serve --https=443 fails without them).
set -euo pipefail

: "${TAILSCALE_AUTHKEY:?set TAILSCALE_AUTHKEY (an ephemeral tag:p0rt1on-serve auth key)}"
HOST="${TAILSCALE_HOSTNAME:-p0rt1on-bootcheck}"
PORT="${MINIO_PORT:-9000}"
NAME="p0rt1on-bootcheck"
IMAGE="p0rt1on-instance:bootcheck"

cd "$(dirname "$0")"

echo "==> building $IMAGE"
docker build -t "$IMAGE" .

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> starting $NAME (hostname=$HOST, minio :$PORT)"
docker run -d --name "$NAME" \
  -e TAILSCALE_AUTHKEY="$TAILSCALE_AUTHKEY" \
  -e TAILSCALE_HOSTNAME="$HOST" \
  -e MINIO_ROOT_USER="bootcheck" \
  -e MINIO_ROOT_PASSWORD="bootcheck-secret-123" \
  -e MINIO_PORT="$PORT" \
  -p "127.0.0.1:$PORT:$PORT" \
  "$IMAGE" >/dev/null

echo "==> waiting for health (up to ~90s)"
for i in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo "?")
  echo "   [$i] health=$status"
  case "$status" in
    healthy)
      echo "==> HEALTHY"
      curl -fsS "http://127.0.0.1:$PORT/minio/health/live" -o /dev/null \
        && echo "   minio/health/live: OK"
      echo "==> tailnet node:"; docker exec "$NAME" tailscale status || true
      echo "PASS"
      exit 0 ;;
    unhealthy)
      echo "==> UNHEALTHY — last 40 log lines:"
      docker logs --tail 40 "$NAME"
      echo "FAIL"; exit 1 ;;
  esac
  sleep 3
done

echo "==> TIMED OUT — last 40 log lines:"
docker logs --tail 40 "$NAME"
exit 1
