# p0rt1on instance image — one container that runs BOTH MinIO and tailscaled.
#
# Per PLAN: each friend (dedicated) or the shared pool is a single long-running
# container. tailscaled (userspace) brings the container onto the tailnet and
# `tailscale serve`s MinIO at https://<hostname>.<tailnet>.ts.net; MinIO runs in
# the SAME container so serve reaches it over plain localhost. The manager reaches
# MinIO for `mc admin` over the docker network (admin plane); friends reach it
# over Tailscale (data plane).
#
# Base is the stock Tailscale image (Alpine; ships tailscaled + tailscale). We add
# the `minio` server + `mc` client binaries + `tini` (PID 1: reaps + forwards
# signals), the same bundling pattern as backup-client.
FROM tailscale/tailscale:v1.84.3

ARG TARGETARCH
# TODO: pin MINIO to a release tag for reproducible builds. To pin, swap the URL
# below for the archive form, e.g.
#   https://dl.min.io/server/minio/release/linux-${MARCH}/archive/minio.RELEASE.2025-04-22T22-12-26Z
RUN apk add --no-cache curl ca-certificates tini \
  && case "${TARGETARCH}" in \
       amd64) MARCH=amd64 ;; \
       arm64) MARCH=arm64 ;; \
       *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://dl.min.io/server/minio/release/linux-${MARCH}/minio" -o /usr/local/bin/minio \
  && curl -fsSL "https://dl.min.io/client/mc/release/linux-${MARCH}/mc" -o /usr/local/bin/mc \
  && chmod +x /usr/local/bin/minio /usr/local/bin/mc \
  && apk del curl

COPY entrypoint.sh /entrypoint.sh
COPY healthcheck.sh /healthcheck.sh
RUN chmod +x /entrypoint.sh /healthcheck.sh

# Container health = tailscale connected AND MinIO live (see healthcheck.sh).
# The manager reads this via `docker inspect .State.Health.Status`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD /healthcheck.sh

ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
