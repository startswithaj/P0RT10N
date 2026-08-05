# E2E tests

End-to-end tests that drive the **containers we ship** — the manager, instance
and backup-client images — over their **public surfaces only** (HTTP tRPC, S3,
the tailnet, the k8s API). They import no app code, so they see exactly what an
admin and a friend see. Excluded from `deno task test` + coverage (filename
`*.e2e.test.ts`).

Running a suite **is** the opt-in: if required infra or config is absent it
**fails with a clear message**, never silently skips (a skip reads as a pass).

```sh
deno task test:e2e        # both suites (~7 min; docker needs .env)
```

Two suites, one per deployment target:

| Suite     | Runtime              | Control plane                                           |
| --------- | -------------------- | ------------------------------------------------------- |
| `docker/` | containers on Docker | **real Tailscale** (proves HTTPS serve with real certs) |
| `k8s/`    | containers on k3d    | **in-cluster headscale** (no account, no secrets)       |

---

## docker — `deno task test:e2e:docker`

`docker/lifecycle.e2e.test.ts`

**Proves:** the real manager image runs as a container (docker socket mounted)
and is driven through its HTTP tRPC surface — login → `addStart` → `claimBundle`
→ offboard. The manager mints the tailnet key from the OAuth client secret, the
instance container enrolls on the real tailnet, and a **friend container** joins
that tailnet with the minted bundle key to write a real Kopia backup through
`tailscale serve`. Only this suite can prove **HTTPS serve with a real cert** —
headscale issues none.

It also asserts the **health checks that only mean something on real
Tailscale**: `tailscaleApi`, `magicDns`, `httpsServe` and `serveTag` all read
the live API, and it confirms `pantry` is absent rather than falsely passing
(the docker pantry is a host path, so that check is not applicable).

The test process never joins the tailnet — the friend container does, exactly
like a friend's machine. So **no host Tailscale is needed**.

**Needs:** a Docker daemon and a real tailnet:
`P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET`, `P0RT1ON_MASTER_KEY`, and
`P0RT1ON_TAILSCALE_TAG_OWNER` — who owns each friend tag in the policy's
`tagOwners`; set it to the tailnet's OAuth client tag (e.g. `tag:p0rt1on`).
REQUIRED on real Tailscale: the client can only mint keys for tags it owns. The
driver reads `.env`, so locally there is nothing to set up.

**⚠ Use a throwaway CI tailnet in CI, never a personal one** — the job mints
keys and creates nodes.

```sh
deno task test:e2e:docker        # build images + run
deno task test:e2e:docker run    # images already built
```

---

## k8s — `deno task test:e2e:k8s`

Every test-only k8s object (headscale, the manager admin Service, the
friend-client namespace + RBAC) lives in `k8s/manifests.yaml`. The namespace,
ServiceAccount, manager **Deployment** and Role come from the shipped
`deploy/k8s/p0rt1on.yaml` — testing the real artifacts is the point. The pantry
`StorageClass` is the same reasoning taken further: `k8s/run.ts` installs the
OpenEBS localpv provisioner via helm, then applies the shipped
`deploy/k8s/pantry.yaml` directly, rather than hand-rolling a class pointed at
k3d's bundled provisioner.

- **`k8s/rbac-psa.e2e.test.ts`** — black-box, as the manager ServiceAccount: the
  least-privilege Role contains it (no cross-namespace reads, no
  self-escalation, no cluster-scoped lists, `get` but not `list` on PVCs), and
  PSA `restricted` refuses a privileged pod.
- **`k8s/health.e2e.test.ts`** — the startup health checks, against a cluster
  that is genuinely broken. `run.ts` breaks one thing from the host (the
  manager's own ServiceAccount deliberately can't), then runs this suite
  in-cluster to ask the manager what its checks say; `HEALTH_SCENARIO` names the
  break in effect. Covers `pantry` and `managerService` on both their ok and
  blocked paths, `instanceImage` warning without gating, and `serveTag`.
  `tailscaleApi`, `magicDns` and `httpsServe` are **not** here — the headscale
  adapter answers those from constants, so they'd read `ok` no matter what;
  they're asserted in the docker suite, on real Tailscale.
- **`k8s/lifecycle.e2e.test.ts`** — runs in-cluster against the **real manager
  Deployment** over HTTP: add → friend backs up over the tailnet → ransomware
  refusal (delete marker written, versions survive, bytes still readable) →
  quota refusal → suspend/resume → rotate (old key dead, new key live) →
  offboard, then a leak check that no PVC/Secret/Service outlives the friend.

**Needs:** a Docker daemon, `k3d`, `kubectl`, `helm` (installs the pantry's
OpenEBS provisioner). No Tailscale account or secrets — the driver mints
headscale keys and writes the manager's config Secret itself.

```sh
deno task test:e2e:k8s            # build images + both suites
deno task test:e2e:k8s build      # (re)build + import images only
deno task test:e2e:k8s rbac-psa   # security checks (images built)
deno task test:e2e:k8s health     # health checks vs a broken cluster
deno task test:e2e:k8s lifecycle  # portion lifecycle (images built)
deno task test:e2e:k8s clean      # delete the k3d cluster
```

**Rebuild rule:** the lifecycle suite runs from the e2e runner image
(`e2e/Dockerfile` — deno + `mc` + the suite, no server or SPA), so **editing it
requires `build`**; the rebuild is seconds, not the manager image's minutes.
Same for any change under `app/`, `instance/` or `backup-client/`. Only
`rbac-psa` runs from the working tree, on the host.

**Cluster lifetime:** a cluster the run CREATED is deleted on exit, including on
failure; a pre-existing cluster is yours and is left alone. `K8S_E2E_KEEP=1`
keeps it either way for a fast rerun loop.

---

## Shared infra (not e2e-only — left in place)

- **`deploy/docker-compose.yml`** — the dev stack.
- **`deploy/k8s/p0rt1on.yaml`** — the production Kubernetes manifest; the k8s
  driver applies it to the test cluster, so a bug in it fails the suite.
- **`deploy/k8s/pantry.yaml`** — the production pantry `StorageClass`; the k8s
  driver applies it (after installing its OpenEBS provisioner via helm), so a
  bug in it fails the suite too.
