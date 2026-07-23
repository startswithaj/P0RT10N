# DEV — running P0RT1ON locally

The dev setup is one container (`docker-compose.yml` + `Dockerfile.dev`) that
runs **both** the Deno manager API and the Vite dev server with hot-reload. It
talks to the host Docker daemon (socket mounted) to launch the per-friend
MinIO + tailscaled instance containers.

## Prerequisites

- A running Docker daemon (Docker Desktop / OrbStack / Colima).
- `.env` at the repo root: `cp .env.example .env`, then fill the required values
  (master key, OAuth client secret, tag owner, tailnet domain, pantry).
- The shared external network (instances join it, created out-of-band):
  ```bash
  docker network create p0rt1on-net
  ```

## Start / stop

```bash
docker compose up -d --build     # first run (builds the dev image)
docker compose up -d             # subsequent starts
docker compose logs -f manager   # follow logs
docker compose down              # stop
```

## URLs

| What                | Address               | Notes                                                                                                                                |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend (Vite)     | http://localhost:5173 | **open this**                                                                                                                        |
| Admin API (tRPC)    | `127.0.0.1:8080`      | loopback **inside the container**; Vite proxies `/trpc` + `/health` here. Not reachable from the host directly — go through `:5173`. |
| MinIO audit webhook | `:8081`               | instances POST activity back here                                                                                                    |

## ⚠️ Applying `.env` changes — recreate, don't restart

`docker compose restart` does **NOT** re-read the compose `env_file`; the
container keeps the OS environment from the last `up`. After **any** `.env`
edit, recreate:

```bash
docker compose up -d --force-recreate
```

The API only reads env at startup, so this reboots it — expect a ~25s window
where the frontend's `/trpc` calls 500 while it comes back. That's the reboot,
not a bug. (Verify what actually loaded with, ids only:
`docker exec p0rt1on-repo-manager-1 sh -c 'printf %s "$P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET" | cut -d- -f3'`.)

## ⚠️ Hot-reload / stale modules

Bind-mount filesystem events are unreliable on macOS, so Vite can miss an edit
and keep serving a stale module — e.g.
`Uncaught SyntaxError: does not provide
an export named 'X'`, which a hard
refresh can't fix (Vite itself is serving the old file). `P0RT1ON_DEV_POLLING=1`
(set in `docker-compose.yml`) makes Vite **poll** instead of relying on FS
events, which catches every change. If a change still won't show,
`docker compose restart manager` forces a fresh read.

## Auth (dev)

- Set `P0RT1ON_ADMIN_USERNAME` + `P0RT1ON_ADMIN_PASSWORD` → login required.
- Comment **both** out → auth disabled (the app opens straight to the
  dashboard). Recreate after changing.

## Tailscale invites (optional)

Email-invite enrollment is optional and layered:

- **Sending invites** needs a **user-owned** personal API token (`tskey-api-…`)
  set as `P0RT1ON_TAILSCALE_API_TOKEN`. Without it, invite mode still works but
  falls back to manual console steps. OAuth clients **cannot** create invites at
  any scope (verified — Tailscale restricts it to user-owned tokens).
- **Detecting acceptance** uses the OAuth client: add a **Users → Read** scope
  and it reads the users list; without that scope it falls back to scanning
  devices (detects a friend once they bring a machine onto the tailnet). See
  README → _Setup — Tailscale OAuth client_.

## Tests / checks (run on the HOST, not the container)

```bash
deno task check:all   # fmt (auto-fix) → typecheck → lint → tests → coverage
deno task test        # unit tests only
```

## Persistence

- **Metadata DB** — `p0rt1on-db` volume (`/app/data/p0rt1on.db`). Migrations run
  automatically at boot; no manual step.
- **`mc` aliases** — `p0rt1on-mc` volume (per-instance admin creds).
- **Friend data (pantry)** — `${P0RT1ON_PANTRY}`, bind-mounted at the **same**
  path in host and container so the manager and the instance containers (which
  run on the host daemon) resolve identical bytes.

Instances launched by the manager are separate containers named
`p0rt1on-instance-<hostname>`; on a failed add the manager reaps them
automatically.
