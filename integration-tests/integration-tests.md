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

Imports reach the app via `../app/packages/server/src/…`; run everything from
the repo root so the `deno.json` import map resolves.

---

## 1. `McShellClient.integration.test.ts` — real `mc` + MinIO

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
  integration-tests/McShellClient.integration.test.ts
```

**Or on the host** if `mc` is installed:

```sh
docker compose -f deploy/docker-compose.yml up -d minio
MINIO_ENDPOINT=http://127.0.0.1:9000 \
  MINIO_ROOT_USER=p0rtadmin MINIO_ROOT_PASSWORD=p0rtadmin123 \
  deno test --allow-read --allow-write --allow-env --allow-ffi --allow-net \
  --allow-run --unstable-ffi integration-tests/McShellClient.integration.test.ts
```

---

## 2. `DockerRuntime.integration.test.ts` — real Docker + instance image

**Verifies:** `DockerRuntime.ensureInstance` launches the combined
MinIO+tailscaled instance container, asserts it's `running`, **idempotent** (a
second `ensureInstance` adopts the same container id) and listed, then removes
the container **and its volumes**.

**Needs:** a Docker daemon, the `p0rt1on-instance` image, and
`TAILSCALE_AUTHKEY` — a Tailscale auth key. An **OAuth client secret also
works** as the key, because the instance advertises its tag
(`--advertise-tags`).

**⚠ Tailnet cleanup:** this test removes only the container/volumes — it does
**not** delete the tailnet node it enrolls (that belongs to the
provisioning/offboard layer, not the runtime). If the node isn't ephemeral,
delete the stray `p0rtit*` device afterward. The full offboard path (which does
delete the node) is covered by the k8s portion tier below.

**Run (on the host):**

```sh
docker build -t p0rt1on-instance:latest instance
TAILSCALE_AUTHKEY=<tskey…> \
  deno test --allow-read --allow-write --allow-env --allow-ffi --allow-net \
  --allow-run --unstable-ffi \
  integration-tests/DockerRuntime.integration.test.ts
```

---

## 3 & 4. Kubernetes tiers — `run-integration.sh`

Driven by **`integration-tests/run-integration.sh`**. The control plane is an
**in-cluster headscale** (`integration-tests/headscale-it.yaml`), so **no
Tailscale account or secrets are needed** — REAL images only.

- **tier1 — `KubernetesRuntime.integration.test.ts`** (host, as the manager
  ServiceAccount): apply → ready → scale → gated teardown, RBAC containment (the
  SA can't exceed its Role), and PSA-`restricted` rejection of a privileged pod.
- **tier2 — `Provisioning.k8s.integration.test.ts`** (in-cluster pod): a real
  **add → rotate → offboard** through the tRPC API with real `mc`, the instance
  image, and a real Kopia backup (a `backup-client` pod over the tailnet). Zero
  mocks; **offboard self-cleans** the node.

**Needs:** a Docker daemon, `k3d`, `kubectl`.

**Run:**

```sh
./integration-tests/run-integration.sh          # build images + both tiers
./integration-tests/run-integration.sh build    # (re)build + import images only
./integration-tests/run-integration.sh tier1    # runtime tier (images built)
./integration-tests/run-integration.sh tier2    # portion tier (images built)
```

**Rebuild rule:** `app/`, `instance/`, or `backup-client/` changed → `build`;
test-file-only edits → just rerun a tier (images are reused).

**Cleanup:** `k3d cluster delete p0rt1on-it`.

---

## Shared infra (not integration-only — left in place)

- **`deploy/docker-compose.yml`** — the dev stack; also provides the MinIO that
  suite 1 runs against.
- **`deploy/k8s/p0rt1on.yaml`** — the production Kubernetes manifest; the k8s
  driver also applies it to the test cluster.
