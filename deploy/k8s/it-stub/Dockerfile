# Stub instance image for the k8s integration tier: satisfies the readiness
# probe (/healthcheck.sh) without a tailnet, runs non-root (PSA restricted),
# and just sleeps. The REAL image is exercised by the nightly e2e tier.
FROM busybox:1.36
RUN printf '#!/bin/sh\nexit 0\n' > /healthcheck.sh && chmod +x /healthcheck.sh
USER 65532:65532
CMD ["sh", "-c", "while true; do sleep 3600; done"]
