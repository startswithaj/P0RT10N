# P0RT1ON

**An orchestrator + web UI for [MinIO](https://min.io) and
[Tailscale](https://tailscale.com) that makes lending storage to your friends
easy — and their backups immutable.**

> **Lend friends portions of your disk as ransomware-resistant, offsite S3
> backup targets.** Self-hosted · Multi-tenant S3 · Over Tailscale ·
> Zero-knowledge

## What it is

Lend portions of your disk to friends as offsite backup targets, managed from a
web UI. Each friend gets their **own S3 bucket** (their size cap, their access
key) reachable **only** over their **own Tailscale endpoint** — and **Object
Lock** keeps recent backups immutable even to whoever holds the friend's
credentials.

Everything P0RT1ON does is doable by hand with `mc` and `tailscaled` — minting
auth keys, provisioning MinIO, setting quotas and Object Lock, wiring up
`tailscale serve`. P0RT1ON is the orchestration + UI on top, so adding a friend
is a form instead of a runbook.

## Why it exists

To run offsite backups for friends on a home server. Lend storage, hand over a
credentials bundle, let each friend back up into a bucket only they can reach.

It's **zero-knowledge**: the server stores only the bytes a client uploads. If
the friend encrypts client-side, you hold ciphertext you can't read — no
encryption password ever exists server-side. The backup tool is the friend's
choice (Kopia recommended; any S3 client works).

## How it works

- **Per-friend isolation.** Each friend is a dedicated MinIO + tailscaled pair
  (own endpoint, VPN-isolated), or shares one pool (buckets kept apart by MinIO
  IAM + Tailscale ACLs). Both modes coexist in one install.
- **Nothing exposed to the public internet.** Everything rides on Tailscale — no
  open ports, no router forwarding, no exposed home IP. There's no public
  endpoint to scan or attack.
- **Headless enrollment, handled by the app.** Each friend gets a
  pre-authorized, single-use, pre-tagged Tailscale auth key (redeemed with
  `tailscale up --authkey=…` — no Tailscale account needed). P0RT1ON mints,
  scopes, and revokes keys via the Tailscale API. (Invite-by-email enrollment is
  planned; the UI previews it but it isn't wired up yet.)
- **Ransomware-resistant.** MinIO **Object Lock** (GOVERNANCE by default) keeps
  recent objects immutable even to whoever holds the friend's credentials —
  friend creds are explicitly denied lock bypass — so a compromised client can't
  encrypt, tamper with, or wipe the backups. A **hard quota** caps each portion.
  Host-disk cost is ~1:1 with the quota (MinIO single-drive mode, no erasure
  parity) plus whatever locked-but-superseded object versions exist until their
  retention expires — budget a little headroom above the quota.
- **Zero-knowledge by construction.** Friend S3 secrets and Tailscale auth keys
  exist only in request scope and are shown once in the UI — never written to
  the DB, cache, or logs. The metadata DB (SQLite) holds no secrets; each
  instance's MinIO root credential is **derived** from `P0RT1ON_MASTER_KEY`, not
  stored.
- **Full lifecycle from the dashboard.** Add · resize quota · rotate key ·
  suspend / resume · offboard. Usage is sampled per bucket; activity comes from
  MinIO audit webhooks POSTed back to the manager — no Prometheus, no agents on
  the friend's side.
- **Runs on any container runtime** — Docker, Podman, Kubernetes.

## Requirements

- A container runtime (Docker/Podman/k8s) — the manager launches the combined
  MinIO + tailscaled instance image per friend.
- A Tailscale account + API access (tailnet + OAuth client) to mint auth keys —
  see [Setup](#setup--tailscale-oauth-client).
- Disk space for the sum of the portions you hand out — one filesystem is fine;
  quotas keep friends apart.
- A volume for the manager's SQLite DB (metadata only, no secrets).

### Details

- **No dedicated disk.** Each per-friend MinIO runs single-node single-drive
  (`minio server /data`); `/data` is a **directory on a volume** (named volume,
  host path, or PVC), not a raw device. Portions are sized by **hard quota**,
  not partitioning, so friends share one filesystem.
- **Metadata only.** The manager's SQLite DB holds no secrets — friend bundles
  are shown once and never persisted.
- **One key to rule the fleet.** `P0RT1ON_MASTER_KEY` deterministically derives
  every instance's root credential. It must be **stable and backed up**: losing
  or changing it loses admin access to every instance. Keep it in a secret
  manager; never commit it.

## Quick start (manager)

```bash
cp .env.example .env   # fill in P0RT1ON_MASTER_KEY, TAILSCALE_OAUTH_CLIENT_SECRET, TAILNET_DOMAIN
docker compose up
```

- Admin UI: `http://127.0.0.1:5173` (dev; the admin API binds loopback-only on
  `:8080` — it is never exposed to friends or the tailnet).
- The manager needs the Docker socket mounted (it launches instance containers)
  and two volumes: the metadata DB and `mc` aliases. The provided
  `docker-compose.yml` wires all of this, including the audit-webhook path from
  instances back to the manager.
- `P0RT1ON_MASTER_KEY` and `TAILSCALE_OAUTH_CLIENT_SECRET` are required — the
  manager refuses to start without them (no stubs, no degraded mode).

## Setup — Tailscale OAuth client

P0RT1ON calls the Tailscale API on **every** add / suspend / offboard (mint the
friend's auth key, scope its ACL, delete its node). Give it a least-privilege,
long-lived **OAuth client** rather than a personal API token (those are
full-access and expire in ≤90 days). The Tailscale API **cannot** create OAuth
clients, so this is a one-time manual step in the admin console.

### 1. Create the tags

Tags must exist in the policy before the client can own/use them.

**Access Controls → `Tags` (right-hand panel) → Create Tag**, twice:

| Tag name        | Tag owner         | Purpose                                                      |
| --------------- | ----------------- | ------------------------------------------------------------ |
| `p0rt1on`       | `autogroup:admin` | the client's identity tag (so it can own + mint friend tags) |
| `p0rt1on-serve` | `tag:p0rt1on`     | worn by each MinIO instance's tailscaled serve node          |

**Save.** Per-friend tags (`tag:p0rt1on-friend-<name>`) are **not** created by
hand — the app adds them at provision time (owned by `tag:p0rt1on`).

### 2. Generate the OAuth client

**Settings → `+ Credential` → OAuth Client.** Set each of these to **Write**
(Write includes Read); leave every other permission at **No access**:

| Permission           | Access    | Why                                                           |
| -------------------- | --------- | ------------------------------------------------------------- |
| **Policy File**      | **Write** | read + edit the ACL (per-friend grant + tagOwners)            |
| **Devices → Core**   | **Write** | list friend nodes (online state) + delete on suspend/offboard |
| **Keys → Auth Keys** | **Write** | mint + revoke each friend's auth key                          |

Attach the tag **`tag:p0rt1on`**, then **Generate** and copy the **client
secret** (shown once) → this is `TAILSCALE_OAUTH_CLIENT_SECRET`.

> **⚠️ Security limitation — read this before using a shared tailnet.** The
> **Policy File → Write** permission is broad. Tailscale does **not** let you
> restrict _which_ ACL rules an OAuth client may create, so a client with this
> permission can edit the **entire** tailnet policy. In practice this means:
> **if this client's secret is compromised, an attacker can write an ACL rule
> that grants a P0RT1ON-generated key access to _any_ machine on your tailnet.**
> P0RT1ON itself only ever writes narrow per-friend rules — but Tailscale can't
> _enforce_ that limit on the credential, so the credential is as powerful as
> the whole policy file.
>
> **Recommendation:** if you have other machines on this tailnet, run P0RT1ON on
> a **separate tailnet (a separate Tailscale account)**. Then even a fully
> compromised client can only affect the P0RT1ON tailnet — your personal
> machines are unreachable because they aren't on it at all. (If you must share
> one tailnet, the alternative is to drop the **Policy File** permission and
> manage the ACL by hand — see the note in step 3.)

### 3. Keep friends off the rest of your tailnet

Tailscale denies everything by default — **unless** your policy has a broad
allow-all (`{"action":"accept","src":["*"],"dst":["*:*"]}`). If it does, scope
it to your own logins so tagged friend devices aren't swept in:

```jsonc
"grants": [
  { "src": ["autogroup:member"], "dst": ["*"], "ip": ["*"] }
]
```

Friend devices are **tagged** (not members), so they can only reach what their
per-friend grant allows — their own storage box, nothing else on your tailnet.

**Least-privilege alternative (no Policy File permission).** If you'd rather the
client be _provably_ unable to widen access (see the warning in step 2), omit
the **Policy File** permission when creating the client and set
`TAILSCALE_ACL_MODE=manual` — P0RT1ON then skips ACL edits and shows you the
grant lines to paste by hand. Either one static rule for all friends:

```jsonc
{ "src": ["tag:p0rt1on-friend"], "dst": ["tag:p0rt1on-serve:443"] }
```

(friends reach only P0RT1ON serve nodes; isolated from each other by MinIO
credentials, not the network), or one rule per friend for full network
isolation:

```jsonc
{ "src": ["tag:p0rt1on-friend-alice"], "dst": ["alice.<tailnet>:443"] }
```

The trade-off is a manual ACL edit when isolation rules change; the win is that
a leaked client can only mint friend-tagged keys — never grant them new reach.

### 4. Environment

| Var                             | Value                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `P0RT1ON_MASTER_KEY`            | strong random value; derives every instance's root credential — **stable, backed up, secret**   |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | the OAuth client **secret** (`tskey-client-…`) — not a personal API token                       |
| `TAILSCALE_TAG_OWNER`           | `tag:p0rt1on`                                                                                   |
| `TAILNET_DOMAIN`                | your MagicDNS base (e.g. `tailXXXX.ts.net`) — used to build `https://<name>.<domain>` endpoints |
| `TAILSCALE_ACL_MODE`            | `auto` (API edits the policy) or `manual` (you paste the grants — step 3)                       |

Put these in `.env` (gitignored — see `.env.example` for the full list).

## How to be a client

If a friend set up a portion for you, backing up is just Tailscale + Kopia. Run
the commands yourself, or use the [`backup-client`](backup-client/) image that
wraps them.

**From the bundle:** S3 endpoint, bucket, access key ID + secret, Tailscale auth
key. **You choose:** a `KOPIA_PASSWORD` — your client-side encryption key. It
never leaves your machine. **Lose it and your backups are unrecoverable.**

### Without Docker

Install [Tailscale](https://tailscale.com/download) and
[Kopia](https://kopia.io/docs/installation/), then:

```bash
# join your friend's tailnet
tailscale up --authkey=tskey-auth-xxxxxxxxxxxx

# create the repo (first time only; --endpoint is host[:port], no scheme)
export KOPIA_PASSWORD='choose-a-strong-passphrase'
kopia repository create s3 \
  --bucket=you \
  --endpoint=you.tailnet-xxxx.ts.net \
  --access-key=AKIAxxxxxxxxxxxx \
  --secret-access-key=xxxxxxxxxxxxxxxxxxxxxxxx \
  --retention-mode=GOVERNANCE --retention-period=30d

# back up (incremental; repeat anytime, schedule however you like)
kopia snapshot create /my/data
```

Later runs: `kopia repository connect s3 …` (same flags minus retention), then
`kopia snapshot create`.

### With Docker

The image joins the tailnet, connects to (or creates) your repo, snapshots the
mounted directory, and exits.

```bash
docker build -t p0rt1on-backup-client backup-client/
cp backup-client/.env.example backup.env   # fill in bundle values + KOPIA_PASSWORD
docker run --rm \
  --env-file backup.env \
  -v /my/data:/data:ro \   # -> BACKUP_PATH=/data
  p0rt1on-backup-client
```

Optional: `-v p0rt1on-ts:/var/lib/tailscale` persists the tailnet node across
runs (the auth key is single-use); `-v p0rt1on-cache:/cache` with
`KOPIA_CACHE_DIRECTORY=/cache` speeds up repeat runs. See
[`backup-client/README.md`](backup-client/README.md) for all options.

## Under the hood

- **Manager:** Deno + tRPC API, SolidJS SPA dashboard, SQLite (Drizzle) metadata
  DB. Shells out to `mc` and `docker` — stock upstream images, pinned.
- **Instance image:** one container running **both** MinIO and tailscaled,
  published at `https://<name>.<tailnet>.ts.net` via `tailscale serve`.
- **Activity:** MinIO audit webhooks → manager (`/internal/audit`), aggregated
  into per-friend stats. Usage sampled via `mc du`.

---

See [`PLAN.md`](PLAN.md) for the full architecture and design rationale.
