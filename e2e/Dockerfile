# This runner is deliberately not the manager image: it needs no docker CLI, SPA, or server, so it builds and imports much faster, and no test code can reach a published image.
FROM denoland/deno:2.9.4

# `mc` here uses the same source and pin as the manager image (see ../Dockerfile), so the suite exercises the exact mc the product ships; keep the two in step.
COPY --from=cgr.dev/chainguard/minio-client:latest /usr/bin/mc /usr/local/bin/mc

WORKDIR /app
COPY deno.json deno.lock ./
COPY app ./app
COPY e2e ./e2e

# Dependencies are cached at build time so a cold start needs no network.
# Runs as `deno`, like the manager image, owning the tree Deno refreshes at startup and the home dir where `mc` keeps its config.
RUN mkdir -p /home/deno \
  && deno cache e2e/k8s/lifecycle.e2e.test.ts \
  && chown -R deno:deno /app /home/deno /deno-dir
USER deno
