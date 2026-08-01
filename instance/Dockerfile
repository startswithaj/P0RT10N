# MinIO runs in the same container as tailscaled so `tailscale serve` reaches it over plain localhost.
FROM tailscale/tailscale:v1.84.3

RUN apk add --no-cache ca-certificates tini

# Chainguard's hardened image replaces minio's archived upstream; the static Go binary runs on this musl base regardless of libc.
# `:latest` is intentionally unpinned since Chainguard's free tier only offers latest.
COPY --from=cgr.dev/chainguard/minio:latest /usr/bin/minio /usr/local/bin/minio

COPY entrypoint.sh /entrypoint.sh
COPY healthcheck.sh /healthcheck.sh
RUN chmod +x /entrypoint.sh /healthcheck.sh

# Health requires tailscaled connected AND MinIO live (see healthcheck.sh); the manager reads it via `docker inspect .State.Health.Status`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD /healthcheck.sh

ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
