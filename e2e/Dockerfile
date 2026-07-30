# The in-cluster e2e runner: deno + `mc` + the suite. Deliberately NOT the
# manager image — the runner needs no docker CLI, no SPA and no server, so it
# builds and imports in a fraction of the time, and no test code can reach a
# published image.
#
#   docker build -f e2e/Dockerfile -t p0rt1on-e2e-runner:e2e .
FROM denoland/deno:2.9.4

# `mc` lets the suite act as a FRIEND over S3. Same source and pin as the
# manager image (see ../Dockerfile) — the test must exercise the mc the
# product ships; keep the two in step.
COPY --from=cgr.dev/chainguard/minio-client:latest /usr/bin/mc /usr/local/bin/mc

WORKDIR /app
COPY deno.json deno.lock ./
COPY app ./app
COPY e2e ./e2e

# Cache deps at build time so a cold start needs no network. Runs as `deno`,
# like the manager image, owning the tree Deno refreshes at startup and the
# home dir `mc` keeps its config in.
RUN mkdir -p /home/deno \
  && deno cache e2e/k8s/lifecycle.e2e.test.ts \
  && chown -R deno:deno /app /home/deno /deno-dir
USER deno
