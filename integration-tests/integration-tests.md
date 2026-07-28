# Integration tests

Tests that drive **real** external systems (MinIO, Docker, Kubernetes) instead
of mocks. They live here, apart from the unit tests, and are **excluded from
`deno task test` + coverage** (filename `*.integration.test.ts`).

Running a suite **is** the opt-in (they're excluded from `deno task test`), so
there's **no `P0RT1ON_INTEGRATION` flag**. If a suite's required infra/config is
absent, it **fails with a clear message** — it never silently skips (a skip
reads as a pass). So a bare `deno task test:integration` (glob
`integration-tests/**/*.integration.test.ts`) only passes when everything below
is set up; run an individual suite — or the k8s driver — for anything narrower.

Imports reach the app via `../../app/packages/server/src/…`; run everything from
the repo root so the `deno.json` import map resolves.

---

## 1. `docker/mc-minio.integration.test.ts` — real `mc` + MinIO

**Verifies:** provisions a lock-enabled bucket + a bucket-scoped user, measures
usage (`mc du`), and deletes GOVERNANCE object-lock content via the root bypass
— against a real MinIO using the **pinned `mc`**.

**Needs:** `mc` on PATH, a MinIO at `MINIO_ENDPOINT` (root creds
`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`).

**Run (in-container — the manager image bundles the pinned `mc`, so no host
install):**

```sh
docker network create p0rt1on-net 2>/dev/null || true
docker compose -f deploy/docker-compose.yml up -d minio   # MinIO on 127.0.0.1:9000
docker build -t p0rt1on-manager:latest .                  # if not already built

docker run --rm -v "$PWD:/app" -w /app \
  -e MINIO_ENDPOINT=http://host.docker.internal:9000 \
  -e MINIO_ROOT_USER=p0rtadmin -e MINIO_ROOT_PASSWORD=p0rtadmin123 \
  --entrypoint deno p0rt1on-manager:latest \
  test --allow-read --allow-write --allow-env --allow-ffi --allow-net \
  --allow-run --unstable-ffi \
  integration-tests/docker/mc-minio.integration.test.ts
```

**Or on the host** if `mc` is installed:

```sh
docker compose -f deploy/docker-compose.yml up -d minio
MINIO_ENDPOINT=http://127.0.0.1:9000 \
  MINIO_ROOT_USER=p0rtadmin MINIO_ROOT_PASSWORD=p0rtadmin123 \
  deno test --allow-read --allow-write --allow-env --allow-ffi --allow-net \
  --allow-run --unstable-ffi integration-tests/docker/mc-minio.integration.test.ts
```

---

## 2. `docker/tailnet-lifecycle.integration.test.ts` — REAL tailnet portion e2e

The only tier that touches a real tailnet, and the only one that can prove
**`tailscale serve` over HTTPS with a real cert** — headscale issues none.

**Verifies:** the **real manager image** runs as a container (docker socket
mounted) and is driven through its **HTTP tRPC surface** — login → `addStart` →
`claimBundle` → `offboardStart`. The manager mints the tailnet key from the
OAuth client secret; the instance container enrols for real; then a **friend
container** joins the same tailnet with the **minted bundle key** and writes a
real Kopia backup through `tailscale serve`.

The test process never joins the tailnet — the friend container does, exactly
like a friend's machine. So **no host Tailscale is needed**.

**Needs:** a Docker daemon and a real tailnet:
`P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET`, `P0RT1ON_MASTER_KEY`, and
`P0RT1ON_ADMIN_USERNAME`/`P0RT1ON_ADMIN_PASSWORD` (auth is mandatory — the test
manager binds non-loopback so it can be driven from outside the container). Also
`P0RT1ON_TAILSCALE_TAG_OWNER` — who owns each friend tag in the policy's
`tagOwners`; set it to the tailnet's OAuth client tag (e.g. `tag:p0rt1on`).
REQUIRED on the real Tailscale backend: the client can only mint keys for tags
it owns, so the API's `autogroup:admin` default 400s at the authkey step
(headscale keeps it optional). The driver reads `.env`, so locally there is
nothing to set up.

**⚠ Use a throwaway CI tailnet in CI, never a personal one** — the job mints
keys and creates nodes.

**Note:** the test manager runs on a per-run `/tmp` DB, so its allocator cannot
see ports a **dev** manager already handed out on the same host. It bind-probes
each candidate, so it only collides with a dev instance that is stopped (its
port reads as free) and gets started again mid-run.

**Run:**

```sh
./integration-tests/docker/run.ts       # build images + run
./integration-tests/docker/run.ts run   # images already built
```

_(Replaced `DockerRuntime.integration.test.ts`, deleted 2026-07-17: it burned a
real auth key to assert only that Docker reported `running` — it never started a
manager, created a portion, or connected to anything. Its one unique assertion,
idempotent adopt, is covered by the `DockerRuntime.test.ts` unit test "adopts a
running container without starting a second", which needs no tailnet.)_

---

## 3 & 4. Kubernetes tiers — `k8s/run.ts`

Driven by **`integration-tests/k8s/run.ts`**. The control plane is an
**in-cluster headscale**, so **no Tailscale account or secrets are needed** —
REAL images only. Every test-only k8s object (headscale, the friend-client
namespace + RBAC, the `p0rt1on-pantry` StorageClass) lives in
`integration-tests/k8s/manifests.yaml`; the namespace, ServiceAccount and
manager Role come from the shipped `deploy/k8s/p0rt1on.yaml`.

- **tier1 — `k8s/runtime.integration.test.ts`** (host, as the manager
  ServiceAccount): apply → ready → scale → gated teardown, RBAC containment (the
  SA can't exceed its Role), and PSA-`restricted` rejection of a privileged pod.
- **tier2 — `k8s/lifecycle.integration.test.ts`** (in-cluster pod): a real **add
  → rotate → offboard** through the tRPC API with real `mc`, the instance image,
  and a real Kopia backup (a `backup-client` pod over the tailnet). Zero mocks;
  **offboard self-cleans** the node.

**Needs:** a Docker daemon, `k3d`, `kubectl`.

**Run:**

```sh
./integration-tests/k8s/run.ts          # build images + both tiers
./integration-tests/k8s/run.ts build    # (re)build + import images only
./integration-tests/k8s/run.ts tier1    # runtime tier (images built)
./integration-tests/k8s/run.ts tier2    # portion tier (images built)
```

**Rebuild rule:** `app/`, `instance/`, or `backup-client/` changed → `build`;
test-file-only edits → just rerun a tier (images are reused).

**Cleanup:** `k3d cluster delete p0rt1on-integrationtest`.

---

## Shared infra (not integration-only — left in place)

- **`deploy/docker-compose.yml`** — the dev stack; also provides the MinIO that
  suite 1 runs against.
- **`deploy/k8s/p0rt1on.yaml`** — the production Kubernetes manifest; the k8s
  driver also applies it to the test cluster.
