FROM tailscale/tailscale:v1.84.3

ARG TARGETARCH
ARG KOPIA_VERSION=0.21.1
RUN apk add --no-cache curl ca-certificates \
  && case "${TARGETARCH}" in \
       amd64) KARCH=x64;   KOPIA_SHA=de47d6b8ae2dfd6199a81d428c9eaed58cfd96a167bdc20407d3264dd18d33ca ;; \
       arm64) KARCH=arm64; KOPIA_SHA=11fad6d30b1e9c264d4a30a886212fcef59a2d174a349a041ee6b24312004b23 ;; \
       *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://github.com/kopia/kopia/releases/download/v${KOPIA_VERSION}/kopia-${KOPIA_VERSION}-linux-${KARCH}.tar.gz" -o /tmp/kopia.tgz \
  && echo "${KOPIA_SHA}  /tmp/kopia.tgz" | sha256sum -c - \
  && tar -xz -C /tmp -f /tmp/kopia.tgz \
  && mv "/tmp/kopia-${KOPIA_VERSION}-linux-${KARCH}/kopia" /usr/local/bin/kopia \
  && chmod +x /usr/local/bin/kopia \
  && rm -rf "/tmp/kopia-${KOPIA_VERSION}-linux-${KARCH}" /tmp/kopia.tgz \
  && apk del curl

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
