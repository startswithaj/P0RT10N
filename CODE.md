# CODE.md — code notes & toggles

Practical "how do I change X" notes for this codebase. Append as things grow.

## Architecture — manager ↔ MinIO / Tailscale

The manager (Deno tRPC server, `app/packages/server/src/main.ts`, :8080) never
speaks the S3 protocol or runs tailscaled itself — it orchestrates via three
CLIs/APIs and stores only metadata (SQLite, no secrets):

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
             (host.docker.internal:<port>)
                 ┌───────────────▼──┴───────────┐
                 │  instance container (1/portion)
                 │  tailscaled + MinIO together │
                 │  `tailscale serve` 443 → :9000
                 └───────────────┬──────────────┘
                                 │ tailnet (MagicDNS HTTPS)
                         friend's S3 client
                     https://<tsHostname>.<tailnet>
```

- **MinIO:** shell-out to `mc` (`src/minio/McShellClient.ts`); aliases per
  instance in `~/.mc`. Ops: `mc mb --with-lock`, `mc admin user/policy`,
  `mc quota set`, `mc retention set`, `mc admin config set audit_webhook`,
  `mc du`. Manager reaches MinIO over the docker network / published port, never
  the tailnet.
- **Tailscale:** REST API v2 only (`src/tailscale/TailscaleHttpApi.ts`,
  `TS_API_TOKEN`) — mint pre-tagged single-use auth keys, edit ACLs/tagOwners,
  list/delete nodes. No LocalAPI/tsnet in the manager.
- **Instances:** one container per portion (`instance/Dockerfile`,
  `entrypoint.sh`): tailscaled joins via `TS_AUTHKEY`, `tailscale serve`
  publishes MinIO :9000 as HTTPS 443 on the tailnet; 4 data volumes (erasure
  set, needed for Object Lock) + 1 tailscale-state volume. `dedicated` = one
  friend per instance; `shared` = one pooled instance, buckets split by MinIO
  IAM + Tailscale ACLs (`src/db/Schema.ts` `instances.kind`).

## UI

### Use Park UI components — not hand-rolled / native

The client is **Park UI (Ark UI + Panda CSS)**. For any interactive UI
(dialogs/modals, menus, switches, tooltips, popovers, etc.) use the Park UI
component, NOT a browser-native `alert`/`prompt`/`confirm` and NOT a bespoke
`css()` modal.

- Components live in `src/components/ui/*.tsx` and wrap the Ark primitive with
  its Panda **recipe** via `createStyleContext(<recipe>)` — see `menu.tsx`,
  `dialog.tsx` as the template.
- **`src/components/ui/` is for Park UI CLI-copied components ONLY** — nothing
  hand-authored. The folder is excluded from coverage, lint, and fmt (see
  `vitest.config.ts`, `client-coverage-threshold.ts`, `deno.json`) on the
  assumption it holds only vendored registry output. Your own composite
  components go up a level in `src/components/` so they stay covered/linted.
- **Theme = vendored legacy preset (since 2026-07):** `@park-ui/panda-preset` is
  discontinued upstream, so its exact output (our accent/gray/radius args) is
  extracted into `src/theme/park-preset.generated.ts` and used as the Panda
  preset — same CSS as the 0.43 package, but source we own (generated — never
  hand-edit; see its header). Regenerate it with
  `app/packages/client/extract-legacy-preset.ts` after editing
  `src/theme/cyan-brand.ts`. The v1-era component wrappers need four
  slots/variants the 0.43 theme lacks — patched via `theme.extend` in
  `panda.config.ts` (see SKEW PATCHES comment there).
- Example: the burger-menu actions open `ActionDialog` (`PortionActions.tsx`)
  built on `components/ui/dialog.tsx`, not `confirm()`/`prompt()`.
- **Adding a component:** `park-ui add` copies v1-REGISTRY wrappers styled for
  the 2026 design language — they will look different against our legacy recipes
  and may reference recipe slots/variants we don't have. After adding: extend
  the legacy recipe via a skew patch in `panda.config.ts` (pattern exists), run
  codegen + `deno task check:client`, and eyeball the result. CLI gotchas: it
  requires a temporary `"baseUrl": "."` in `tsconfig.json` (remove after — tsc 6
  hard-errors on it; upstream bug
  https://github.com/chakra-ui/park-ui/issues/540), and `components.json` holds
  its aliases.

### IMPORTANT: no disabled buttons without a visible reason

A disabled button must never leave the user guessing. If a button is disabled,
the UI must show WHY, right there — inline validation text under the offending
field(s), or helper text next to the button (e.g. "Enter the portion's name to
confirm", "Name must be at least 3 characters"). If the reason can't be shown,
don't disable the button: let the click run validation and surface the errors.
Applies to every action button (submit, confirm, destructive).

### Card drop shadow

Card surfaces (dashboard cards, status summary cards, the add-portion form, the
provisioning checklist, the bundle card + its code blocks) use Panda/Park UI's
**built-in shadow scale** rather than a custom token — `boxShadow: "lg"`.

- **Where:** `boxShadow: "lg"` in the relevant `css({ ... })` blocks across
  `src/App.tsx`, `src/StatusPage.tsx`, `src/AddPortion.tsx`,
  `src/Provisioning.tsx`, and `src/Bundle.tsx`.
- **Scale:** Park exposes `xs, sm, md, lg, xl` (theme-aware via gray-alpha).
  Park's `card` recipe already applies `lg` by default; we set it explicitly on
  the non-Park surfaces so every panel matches.
- **List rows** (Status page service rows) get `sm`, not `lg` — dense repeating
  items want texture, not elevation competing with the stat cards.
- These shadows are intentionally subtle on the dark indigo canvas. If you want
  stronger dark-mode elevation later, replace `"lg"` with a custom theme-aware
  semantic token (separate `base`/`_dark` values + a faint top highlight).

**Turn it off (keep the flat, border-only look):**

Replace `boxShadow: "lg"` with `boxShadow: "none"` across those five files (e.g.
find-and-replace), then rebuild:

```bash
cd app/packages/client
deno task build     # or just restart `deno task dev` (root: `deno task dev:web`)
```

To go softer/stronger instead of off, change `"lg"` to `"md"`/`"sm"` (softer) or
`"xl"` (stronger) — same scale, no config change needed.
