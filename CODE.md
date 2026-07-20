# CODE.md — code notes & toggles

Practical "how do I change X" notes. Append as things grow.

## Architecture

The manager (Deno tRPC server, `app/packages/server/src/main.ts`, :8080) never
speaks S3 and never runs tailscaled. It orchestrates three tools and stores only
metadata (SQLite, no secrets):

```
                 ┌──────────────────────────────┐
Tailscale REST   │  manager (Deno, tRPC :8080)  │
api.tailscale.com│  auth keys / ACLs / nodes    │
     ◄───────────┤  TailscaleHttpApi (fetch)    │
                 │                              │
docker CLI       │  DockerRuntime               │
(mounted socket) ◄──── launch/stop instances    │
                 │                              │
mc CLI           │  McShellClient               │
(bundled binary) ◄──── buckets/users/policies/  │
                 │      quota/retention/usage   │
                 └───────────────┬──▲───────────┘
                       admin ops │  │ audit webhook POSTs
        (host: 127.0.0.1:<port> / network: container name)
                 ┌───────────────▼──┴───────────┐
                 │  instance container (1/portion)
                 │  tailscaled + MinIO together │
                 │  `tailscale serve` 443 → :9000
                 └───────────────┬──────────────┘
                                 │ tailnet (MagicDNS HTTPS)
                         friend's S3 client
                     https://<tsHostname>.<tailnet>
```

### MinIO — `src/minio/McShellClient.ts`

- Shell-out to `mc`; creds ride a per-call `MC_HOST_<alias>` env var (derived
  from the master key, URL-encoded) — no `mc alias set`, no `~/.mc` state,
  nothing secret on argv.
- Ops used: `mc mb --with-lock`, `mc admin user/policy`, `mc quota set`,
  `mc retention set`, `mc admin config set audit_webhook`, `mc du`.
- Manager reaches MinIO over the admin plane — never the tailnet. Endpoint is
  composed in ONE place (`runtime/adminEndpoint.ts`, exposed as
  `McClientFactory.adminEndpoint`), mode-picked by
  `P0RT1ON_INSTANCE_ADDRESSING`:
  - `host` (default) — `http://127.0.0.1:<port>` via the loopback publish.
  - `network` — `http://p0rt1on-instance-<alias>:<port>` over the shared docker
    network (containerized manager; loopback publishes are unreachable
    cross-container on Linux).

### MinIO events — `src/minio-events/`

- Instances POST audit webhooks to a dedicated listener (fixed :8081,
  `EVENT_PORT` in `lib/Env.ts`, `/internal/minio-events`, token-guarded) — never
  the admin API.
- The sink just `bus.publish(raw)`. `MinioEventBus` fans each RAW payload to N
  independent subscribers via bounded, drop-oldest queues — a slow consumer
  never back-pressures ingestion. A 204 means "enqueued", not "persisted"
  (best-effort; overflow drops the tail).
- The bus owns the shared shutdown `AbortController` (passed to its
  constructor); `bus.subscribe(name)` wires that signal into each subscription,
  so callers pass no signal. SIGTERM aborts it → every subscription tears down.
- Each consumer takes its subscription and **starts on construction** (no
  `run()` call); a `readonly done` promise resolves when its stream ends, and it
  catches its own errors so a fire-and-forget never rejects.
- Consumers `.pipe(...)` stream stages. Parse + friend-resolution each live in
  ONE place, chained at the call site:
  `bus.subscribe(name).pipe(parseMinioEvent)
  .pipe(resolveFriend(lookup))` —
  `resolveFriend` does bucket→friend + drops the manager's own root-key polling
  (which also stops the sampler self-triggering). Each metrics consumer gets its
  OWN subscription (own queue) so both see every event; sharing one would split
  the stream.
  - `MinioEventAggregator` — folds the resolved stream into per-friend
    `activity`.
  - `UsageSampler` — debounces `mc du` off the same stream (a peer, NOT chained
    off the aggregator).
  - `MinioEventForwarder` — ships RAW payloads byte-identical to
    `P0RT1ON_MINIO_FORWARD_URL` (optional; `P0RT1ON_MINIO_FORWARD_AUTHORIZATION`
    sent verbatim), mirroring MinIO's client (retry 5×1s, best-effort, failures
    logged).

### Runtimes — `src/runtime/`

`InstanceRuntime` is the only seam; callers speak domain language (a tripwire
test bans docker literals outside `runtime/`). Selected by
`P0RT1ON_RUNTIME=docker|kubernetes` (default docker) in `app.ts` only.

- **docker** (`DockerRuntime.ts`) — one container per instance; volume
  names/network/env-file secret transport all derived inside the runtime. The
  network is the `DOCKER_NETWORK` constant (`p0rt1on-net`), created out-of-band
  and joined by both sides — not configurable.
  - Per-portion CPU/memory via `P0RT1ON_PORTION_DOCKER_CPU_REQUEST` (→
    `--cpu-shares`) / `_CPU_LIMIT` (→ `--cpus`) / `_MEMORY_REQUEST` (→
    `--memory-reservation`) / `_MEMORY_LIMIT` (→ `--memory`); all optional,
    unset = no cap.
- **kubernetes** (`KubernetesRuntime.ts`) — typed `@cloudydeno` client
  (`CoreV1Api`/`AppsV1Api` over a `RestClient`), no kubectl; per instance:
  StatefulSet(1) + Service + Secret + 2 PVCs.
  - Least privilege: userspace tailscaled (`TS_USERSPACE=true`, no
    capabilities/devices) so the namespace enforces PSA `restricted`; instance
    pods get `automountServiceAccountToken: false`; manager RBAC is one
    namespace-scoped Role (see `deploy/k8s/p0rt1on.yaml`).
  - Reads/scale avoid subresources the Role doesn't grant: pod health uses
    `getPod` (not `getPodStatus` → `pods/status`), suspend/resume json-patch
    `/spec/replicas` on the main StatefulSet (not the `/scale` subresource).
  - Per-portion CPU/memory via `P0RT1ON_PORTION_K8S_CPU_REQUEST`/`_CPU_LIMIT`/
    `_MEMORY_REQUEST`/`_MEMORY_LIMIT` (native k8s values → container
    `resources.requests`/`.limits`); all optional, unset = no block.
  - `buildRestClient()` auto-detects the mounted in-cluster SA (token + CA +
    server) via `forInCluster`, or takes explicit `P0RT1ON_K8S_API`/`_TOKEN`/
    `_CA_FILE` for dev — no more `DENO_CERT`. Config (all `P0RT1ON_K8S_`
    prefixed): `NAMESPACE/API/TOKEN/CA_FILE/DATA_SIZE/STATE_SIZE/STORAGE_CLASS`.
  - Verified on k3d by `integration-tests/run-integration.sh` (no secrets needed
    — an in-cluster HEADSCALE is the control plane; REAL images only): runtime
    tier (apply idempotency, scale, PVC gating, RBAC containment, PSA rejection,
    real tailnet enrollment) + portion tier (full tRPC addStart→rotate→offboard,
    zero mocks: real enrollment, serve in HTTP mode, node deleted on offboard;
    uid 1000 under PSA `restricted`). The portion tier ALSO runs the friend's
    real backup: a `backup-client` pod joins the same tailnet under its friend
    tag and snapshots with Kopia through the instance's serve (WireGuard) using
    only bundle contents — proving the ACL grant, MagicDNS, serve, and an actual
    write to the bucket. That pod runs as ROOT in the non-restricted
    `p0rt1on-it-clients` namespace (like a friend's docker host); a test-only
    Role there lets the manager SA launch it — the production Role has no
    pod-create. Subcommands: `build` (rerun after image-source changes) /
    `tier1` / `tier2` — test iterations reuse the fixed images. Still pending
    the nightly real-Tailscale tier: serve over HTTPS (headscale issues no
    certs).
  - `serveMode` (`https`|`http`, from `P0RT1ON_TAILSCALE_SERVE_MODE`) drives
    THREE things in lockstep: the instance's serve port (443/80), the friend
    endpoint scheme, and the ACL grant port — all from one env value so they
    can't drift.

### Tailscale — `src/tailscale/TailscaleHttpApi.ts`

- REST API v2 only (`P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET`). No LocalAPI, no
  tsnet in the manager.
- Ops used: mint pre-tagged single-use auth keys, edit ACLs/tagOwners,
  list/delete nodes.

### Headscale — `src/tailscale/HeadscaleHttpApi.ts`

- Second `TailscaleApi` impl over headscale's v1 REST API; selected by
  `P0RT1ON_TAILSCALE_BACKEND=headscale` (`P0RT1ON_HEADSCALE_URL/_API_KEY/_USER`
  required instead of the OAuth secret). The integration-test control plane.
- API quirks handled: numeric user ids (name resolved per call), expire preauth
  keys by key string, classic `acls` policy as a JSON string (needs headscale
  `policy.mode: database`), first-ever policy GET is a 500 "not found" (=
  empty), tags deduped across forced/valid lists.
- No HTTPS cert issuance → instances run `tailscale serve` in HTTP mode: set
  `P0RT1ON_TAILSCALE_LOGIN_SERVER` + `P0RT1ON_TAILSCALE_SERVE_MODE=http`
  (plumbed to instance env via `Env.instanceTailscale()` → both runtimes).

### Instances — `instance/Dockerfile`, `entrypoint.sh`

- One container per portion: tailscaled joins via `TAILSCALE_AUTHKEY`, then
  `tailscale serve` publishes MinIO :9000 as HTTPS 443 on the tailnet.
- Volumes: 1 data volume + 1 tailscale-state volume. MinIO single-drive (SNSD)
  fully supports Object Lock — the old ">=4 drives" rule died with the legacy FS
  backend in 2022 (probe-verified 2026-07-07). Pre-SNSD instances used 4 erasure
  volumes (`-1..4`); teardown still reaps those legacy names. SNSD has zero
  parity: bitrot is detected, not self-healed — the friend's client re-uploading
  is the redundancy.
- Isolation (`instances.kind` in `src/db/Schema.ts`):
  - `dedicated` — one friend per instance.
  - `shared` — one pooled instance; buckets split by MinIO IAM + Tailscale ACLs.

## UI

### Use Park UI components — never hand-rolled / native

For any interactive UI (dialogs, menus, switches, tooltips, popovers…) use the
Park UI component. Never browser-native `alert`/`prompt`/`confirm`, never a
bespoke `css()` modal.

- Wrappers live in `src/components/ui/*.tsx`: Ark primitive + Panda recipe via
  `createStyleContext(<recipe>)`. Template examples: `menu.tsx`, `dialog.tsx`.
- `src/components/ui/` holds **CLI-copied components only** — nothing
  hand-authored. It's excluded from coverage/lint/fmt (`vitest.config.ts`,
  `client-coverage-threshold.ts`, `deno.json`) on that assumption.
- Your own composites go one level up in `src/components/` so they stay covered
  and linted.
- Worked example: burger-menu actions open a per-action dialog
  (`OffboardDialog`, `SuspendDialog`, …) built on `components/ui/dialog.tsx` —
  not `confirm()`.

### Composing UI — small focused components, not switch-on-kind god-components

One responsibility per component, one component per file (enforced by the
`one-component-per-file` lint). When several UI states share a shell, factor the
shell + building blocks out and write one focused component per case — don't
funnel them into a single component that `switch`es on a `kind` prop (its copy,
colour and logic all end up branching in one place and rot).

- Worked example — the action dialogs: `DialogShell` (frame + title + Enter),
  `ConfirmActions` (cancel/confirm row), `LoadingButton` (border-loader button),
  then one dialog per action (`SuspendDialog`, `ResizeDialog`, `OffboardDialog`,
  …) and an `ActionDialogs` router that renders the matching one. Each dialog
  owns its own state, copy and mutation. There is no generic `ActionDialog`.
- Variant/appearance comes from the caller, never a string check inside the
  leaf: the confirm button's danger-red is a `destructive` prop each dialog
  passes (`OffboardDialog` sets it) — not a `kind === "offboard"` inside the
  button.
- Icons: render a lucide icon directly (`<Trash2 size={15} />`). Only wrap in
  `<Icon>` when you need recipe sizing/colour — and note `Icon` is a `<span>`
  (an `<svg>` inside an `<svg>` gets clipped).

Testing follows the same grain — one focused test file per component, not one
that drives the whole app (Vitest + `@solidjs/testing-library`):

- Render the component directly (`render(() => <SuspendDialog friend={…} …/>)`)
  and drive it with `fireEvent`; don't route through `App`.
- Mock the data boundary once at the top: `vi.mock("../trpc.ts", …)` with
  `vi.fn()` mutations; shared fixtures/mocks live in `test-helpers/`
  (`makeFriend`), never inline. Module-level test consts need `vi.hoisted` (the
  `no-test-globals` lint rule).
- Assert behaviour, not markup: the mutation args, `onClose`, and toast feedback
  (`vi.spyOn(toaster, "create")` → success/error variant). See
  `ActionDialogs.test.tsx`.

### Theme — Park UI v1 vendored as source (since 2026-07)

Park UI v1 ships no theme package; `park-ui init`/`add` copy the theme into
`src/theme/` as source we own.

Layout:

- `theme/recipes/` — one recipe file per component, plus `index.ts`.
- `theme/colors/` — semantic palettes (`cyan`, `slate`, `red`, `green`).
- `theme/tokens/` — base tokens (colors, durations, shadows, z-index).
- `theme/*.ts` — conditions, global-css, keyframes, text/layer/animation styles.
- `panda.config.ts` imports all of it directly. No `presets` key — Panda's
  defaults supply the base scales and the `.dark` condition.

Brand deviations from stock Park are marked `BRAND OVERRIDE` at the point of
change:

- `colors/cyan.ts` — scale re-anchored on #2DE2E6; indigo ink on solid fills.
- `colors/slate.ts` — dark surfaces are brand indigo #1F1640, not near-black.
- `recipes/button.ts`, `recipes/badge.ts` — outline/plain variants pinned to
  gray (neutral chrome, not accent).
- `recipes/radio-group.ts` — the 0.43 "donut" indicator.
- `panda.config.ts` — canvas/spark/onAccent/warning tokens, fonts, radii mapping
  (`l1/l2/l3` = `sm/md/lg`), compat tokens for app code (`border.default`,
  `fg.error`, `bg.muted`).

### Adding a Park UI component

1. Add a temporary `"baseUrl": "."` to `tsconfig.json` (the CLI needs it; tsc 6
   hard-errors on it — upstream bug
   https://github.com/chakra-ui/park-ui/issues/540).
2. `npx @park-ui/cli add <name>` — copies the wrapper into `components/ui/` AND
   its recipe into `src/theme/recipes/`, updating both index files.
3. **If the recipe file already existed it got overwritten** — grep it for
   `BRAND OVERRIDE` first and re-apply after.
4. Remove the `baseUrl` again, run codegen + `deno task check:client`, and
   eyeball the result.

Notes: `components.json` holds the CLI's aliases. `park-ui init` is
interactive-only, and its radius prompt is ignored upstream — our radii mapping
lives in `panda.config.ts`.

### No disabled buttons without a visible reason

A disabled button must never leave the user guessing.

- Show WHY, right there: inline validation under the offending field, or helper
  text next to the button ("Enter the portion's name to confirm").
- If the reason can't be shown, don't disable — let the click run validation and
  surface the errors.
- Applies to every action button: submit, confirm, destructive.

### Card drop shadow

Card surfaces use Park's **built-in shadow scale**, not a custom token.

- `boxShadow: "lg"` on cards in `App.tsx`, `StatusPage.tsx`, `AddPortion.tsx`,
  `Provisioning.tsx`, `Bundle.tsx`. Park's `card` recipe already defaults to
  `lg`; we set it explicitly on non-Park surfaces so every panel matches.
- List rows (Status page service rows) get `sm` — dense repeating items want
  texture, not elevation competing with the stat cards.
- Scale is `xs…xl`, theme-aware via gray-alpha; intentionally subtle on the dark
  indigo canvas. For stronger dark-mode elevation later, swap `"lg"` for a
  custom semantic token (separate `base`/`_dark` values + faint top highlight).
- **Turn shadows off:** find-and-replace `boxShadow: "lg"` → `"none"` across
  those five files, then rebuild (`deno task build` or restart dev). Softer or
  stronger: `"md"`/`"sm"` or `"xl"` — no config change needed.
