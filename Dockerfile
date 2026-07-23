# p0rt1on manager image: Deno app + bundled `mc` + the docker CLI. The manager
# launches the combined instance image (see instance/) by shelling out to
# `docker` against the host daemon (mount /var/run/docker.sock at runtime).
#
# Three stages: `base` does all the work, `integration` adds the test suites,
# and `manager` (production) is LAST so a bare `docker build` — what the GHCR
# publish job runs — resolves to it and can never ship test code.
FROM denoland/deno:2.8.2 AS base

# Bundle the docker CLI the app shells out to (launch/inspect instance
# containers). TARGETARCH is provided by buildkit (amd64 / arm64) so this builds
# on either. docker has no published checksum, so DOCKER_SHA is self-computed
# from the pinned tgz — a version bump must recompute both per-arch hashes or the
# build fails. `mc` is copied from Chainguard's hardened image below.
ARG TARGETARCH
ARG DOCKER_VERSION=27.5.1
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && case "${TARGETARCH}" in \
       amd64) DOCKER_ARCH=x86_64;  DOCKER_SHA=4f798b3ee1e0140eab5bf30b0edc4e84f4cdb53255a429dc3bbae9524845d640 ;; \
       arm64) DOCKER_ARCH=aarch64; DOCKER_SHA=e6b53725a73763ab3f988c73f8772eaed429754c1a579db5ff11f21990fd1817 ;; \
       *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://download.docker.com/linux/static/stable/${DOCKER_ARCH}/docker-${DOCKER_VERSION}.tgz" -o /tmp/docker.tgz \
  && echo "${DOCKER_SHA}  /tmp/docker.tgz" | sha256sum -c - \
  && tar -xz -C /usr/local/bin --strip-components=1 -f /tmp/docker.tgz docker/docker \
  && rm -f /tmp/docker.tgz \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# mc (MinIO admin): Chainguard's hardened minio-client — upstream minio/mc was
# archived 2026-02. Installed as `mc` so the app's argv is unchanged. `:latest`
# is unpinned by design (Chainguard's free tier is latest-only).
COPY --from=cgr.dev/chainguard/minio-client:latest /usr/bin/mc /usr/local/bin/mc

WORKDIR /app
COPY deno.json deno.lock ./
COPY app ./app
COPY drizzle ./drizzle

# Cache deps + typecheck at build time.
RUN deno cache app/packages/server/src/main.ts

# Build the SPA (Panda codegen + Vite) into packages/server/dist; the server
# finds it there at runtime and serves it (see main.ts). Dev uses the Vite dev
# server instead (Dockerfile.dev), so this step is production-only.
RUN deno task --cwd app/packages/client build

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
