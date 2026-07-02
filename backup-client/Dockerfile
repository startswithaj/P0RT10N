# p0rt1on backup-client image: a self-contained, one-shot backup runner a friend
# launches on a cron job. Brings up Tailscale (userspace), connects/creates their
# Kopia repo, snapshots a mounted directory into their bucket, then exits.
#
# Base is the stock Tailscale image (Alpine; ships tailscaled + tailscale). We add
# the one extra binary the entrypoint shells out to — the static `kopia` client —
# the same way the manager image bundles `mc`.
FROM tailscale/tailscale:v1.84.3

# Bundle the Kopia client. TARGETARCH is provided by buildkit (amd64 / arm64) so
# this builds on either. Pinned for reproducible images (PLAN.md: pin images).
ARG TARGETARCH
ARG KOPIA_VERSION=0.21.1
RUN apk add --no-cache curl ca-certificates \
  && case "${TARGETARCH}" in \
       amd64) KARCH=x64 ;; \
       arm64) KARCH=arm64 ;; \
       *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://github.com/kopia/kopia/releases/download/v${KOPIA_VERSION}/kopia-${KOPIA_VERSION}-linux-${KARCH}.tar.gz" \
       | tar -xz -C /tmp \
  && mv "/tmp/kopia-${KOPIA_VERSION}-linux-${KARCH}/kopia" /usr/local/bin/kopia \
  && chmod +x /usr/local/bin/kopia \
  && rm -rf "/tmp/kopia-${KOPIA_VERSION}-linux-${KARCH}" \
  && apk del curl

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
