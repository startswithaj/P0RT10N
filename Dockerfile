# p0rt1on manager image: Deno app + bundled `mc` + the docker CLI. The manager
# launches the combined instance image (see instance/) by shelling out to
# `docker` against the host daemon (mount /var/run/docker.sock at runtime).
#
# Three stages: `base` does all the work, `integration` adds the test suites,
# and `manager` (production) is LAST so a bare `docker build` — what the GHCR
# publish job runs — resolves to it and can never ship test code.
FROM denoland/deno:2.8.2 AS base

# Bundle the two external binaries the app shells out to: `mc` (MinIO admin) and
# the docker CLI (launch/inspect instance containers). TARGETARCH is provided by
# buildkit (amd64 / arm64) so this builds on either.
ARG TARGETARCH
ARG DOCKER_VERSION=27.5.1
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL "https://dl.min.io/client/mc/release/linux-${TARGETARCH}/mc" -o /usr/local/bin/mc \
  && chmod +x /usr/local/bin/mc \
  && case "${TARGETARCH}" in \
       amd64) DOCKER_ARCH=x86_64 ;; \
       arm64) DOCKER_ARCH=aarch64 ;; \
       *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://download.docker.com/linux/static/stable/${DOCKER_ARCH}/docker-${DOCKER_VERSION}.tgz" \
     | tar -xz -C /usr/local/bin --strip-components=1 docker/docker \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY deno.json deno.lock ./
COPY app ./app
COPY drizzle ./drizzle

# Cache deps + typecheck at build time.
RUN deno cache app/packages/server/src/main.ts

# Build the SPA (Panda codegen + Vite) into packages/server/dist; the server
# serves it from STATIC_DIR at runtime (see server.ts). Dev uses the Vite dev
# server instead (Dockerfile.dev), so this step is production-only.
RUN deno task --cwd app/packages/client build
ENV STATIC_DIR=/app/app/packages/server/dist

EXPOSE 8080
# Loopback-only admin surface; publish via the compose port mapping.
CMD ["deno", "run", \
  "--allow-read", "--allow-write", "--allow-env", "--allow-ffi", "--allow-net", "--allow-run", \
  "--unstable-ffi", "app/packages/server/src/main.ts"]

# Test-only image: the integration suites layered onto the real manager image,
# so CI exercises exactly what ships (pinned `mc`, real SPA build). Built with
# `--target integration` — see integration-tests/integration-tests.md.
FROM base AS integration
COPY integration-tests ./integration-tests

# Production. Deliberately last and deliberately empty: the default build target
# is the final stage, so forgetting `--target` yields the image WITHOUT tests.
FROM base AS manager
