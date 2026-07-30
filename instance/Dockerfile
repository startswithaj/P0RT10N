# p0rt1on instance image — one container that runs BOTH MinIO and tailscaled.
#
# Per PLAN: each friend (dedicated) or the shared pool is a single long-running
# container. tailscaled (userspace) brings the container onto the tailnet and
# `tailscale serve`s MinIO at https://<hostname>.<tailnet>.ts.net; MinIO runs in
# the SAME container so serve reaches it over plain localhost. The manager runs
# `mc admin` against it over the network (admin plane); friends reach it over
# Tailscale (data plane). Neither needs a client in here.
#
# Base is the stock Tailscale image (Alpine; ships tailscaled + tailscale). We add
# `tini` (PID 1: reaps + forwards signals) via apk, and copy in the `minio`
# server binary from Chainguard's hardened image (below).
FROM tailscale/tailscale:v1.84.3

# tini = PID 1; ca-certificates for TLS to the tailnet/control plane.
RUN apk add --no-cache ca-certificates tini

# minio: Chainguard's hardened image — upstream minio was archived 2026-02. A
# static Go binary, so it runs on this Alpine (musl) base regardless of libc.
# `:latest` is unpinned by design (free tier is latest-only).
COPY --from=cgr.dev/chainguard/minio:latest /usr/bin/minio /usr/local/bin/minio

COPY entrypoint.sh /entrypoint.sh
COPY healthcheck.sh /healthcheck.sh
RUN chmod +x /entrypoint.sh /healthcheck.sh

# Container health = tailscale connected AND MinIO live (see healthcheck.sh).
# The manager reads this via `docker inspect .State.Health.Status`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD /healthcheck.sh

ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
