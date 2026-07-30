# p0rt1on manager image: Deno app + bundled `mc` + the docker CLI. The manager
# launches the combined instance image (see instance/) by shelling out to
# `docker` against the host daemon (mount /var/run/docker.sock at runtime).
#
# One stage, no test code: the e2e runner is a separate image (e2e/Dockerfile).
FROM denoland/deno:2.9.4 AS base

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

# Fetch @db/sqlite's native library now: it downloads on first import, and a
# cold start should not need the network.
RUN deno eval --unstable-ffi 'import "@db/sqlite";'

# The image RUNS as `deno`, so it owns what the app writes: the workspace
# links Deno refreshes at startup, its module cache, the data dir a volume
# mounts over, and the home dir `mc` keeps its config in. Deployments needing
# root (the docker socket) say so explicitly — see docker-compose.yml.
RUN mkdir -p /data /home/deno \
  && chown -R deno:deno /app /data /home/deno /deno-dir
USER deno

EXPOSE 8080
# Loopback-only admin surface; publish via the compose port mapping.
CMD ["deno", "run", \
  "--allow-read", "--allow-write", "--allow-env", "--allow-ffi", "--allow-net", "--allow-run", \
  "--unstable-ffi", "app/packages/server/src/main.ts"]

