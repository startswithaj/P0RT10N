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
- **Enrollment, handled by the app — two ways.** _Auth key_ (default, headless):
  the friend redeems a pre-authorized, single-use, pre-tagged key with
  `tailscale up --authkey=…`, no Tailscale account needed. _Email invite_
  (optional, needs a personal API token): P0RT1ON emails a Tailscale invite so
  they join with their own account and devices. Either way, P0RT1ON mints,
  scopes, and revokes access through the Tailscale API.
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
- A Tailscale account + API access (tailnet + OAuth client) to mint auth keys,
  with **MagicDNS + HTTPS certificates enabled** on the tailnet — see
  [Setup](#setup--tailscale-oauth-client).
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
- **Back up the master key.** `P0RT1ON_MASTER_KEY` deterministically derives
  every instance's root credential, so it must be **stable and backed up**: lose
  or change it and you lose admin access to every instance. Keep it in a secret
  manager; never commit it.

## Quick start (manager)

```bash
cp .env.example .env   # fill in the required values; everything else has a default
docker compose up
```

- Admin UI: `http://127.0.0.1:5173` (dev; the admin API binds loopback-only on
  `:8080` — it is never exposed to friends or the tailnet).
- The manager needs the Docker socket mounted (it launches instance containers)
  and two volumes: the metadata DB and `mc` aliases. The provided
  `docker-compose.yml` wires all of this, including the audit-webhook path from
  instances back to the manager.
- A handful of settings are required — the master key, the OAuth client secret,
  the OAuth client's tag, and the pantry (where friend data is stored). The
  manager refuses to start without them (no stubs, no degraded mode);
  `.env.example` explains each one.

## Setup — Tailscale OAuth client

P0RT1ON calls the Tailscale API on **every** add / suspend / offboard (mint the
friend's auth key, scope its ACL, delete its node). Give it a least-privilege,
long-lived **OAuth client** rather than a personal API token (those are
full-access and expire in ≤90 days). The Tailscale API **cannot** create OAuth
clients, so this is a one-time manual step in the admin console.

### Prerequisite: enable MagicDNS + HTTPS certificates

Each instance publishes its MinIO over the tailnet via `tailscale serve` with
HTTPS (`--https=443`), which needs your tailnet to issue TLS certificates. That
feature is **off by default**, and the Tailscale API can neither turn it on nor
even report whether it's on — so enable it once, by hand, in the admin console:

1. Admin console → **DNS**.
2. Enable **MagicDNS** (if it isn't already).
3. Under **HTTPS Certificates**, click **Enable HTTPS**.

These are two separate switches: MagicDNS is the prerequisite, HTTPS is a second
toggle on top of it — turning on MagicDNS alone is **not** enough. Skip this and
every provision fails its health check with _"Serve is not enabled on your
tailnet."_

> **No cert issuance? (e.g. headscale).** If your control plane can't mint
> certs, set `P0RT1ON_TAILSCALE_SERVE_MODE=http`: MinIO is served as plain HTTP
> over the (already encrypted) tailnet instead of HTTPS.

### Concepts

- **OAuth client** — a Tailscale credential (id + secret), created in step 2.
  The manager reads its secret from `P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET` to
  authenticate API calls. The credential, not the manager.
- **`tag:p0rt1on`** — the OAuth client's identity tag; owns and mints the
  others. You create it (step 1).
- **`tag:p0rt1on-serve`** — worn by each MinIO instance's tailscaled serve node.
  Manager declares it (owned by `tag:p0rt1on`) at provision time.
- **`tag:p0rt1on-friend-<name>`** — worn by each friend's node. Manager declares
  one per friend at provision time.

The friend and serve tags namespace the connection: the ACL is written as
`src: tag:p0rt1on-friend-alice → dst: alice's serve node`, so a friend's node
can open a tailnet connection to only its own instance — not the manager, not
other friends' instances. The tag is the identity the ACL matches on; without it
a node is unscoped. Auth keys are minted pre-tagged, so a friend's node wears
its tag from the moment it joins.

### 1. Create the tags

The OAuth client's identity tag must exist in the policy before the OAuth client
can own or use it.

**Access Controls → `Tags` (right-hand panel) → Create Tag**, once:

| Tag name  | Tag owner         | Purpose                                                            |
| --------- | ----------------- | ------------------------------------------------------------------ |
| `p0rt1on` | `autogroup:admin` | the OAuth client's identity tag (so it can own + mint friend tags) |

**Save.** The serve tag (`tag:p0rt1on-serve`, worn by each MinIO instance's
tailscaled serve node) and the per-friend tags (`tag:p0rt1on-friend-<name>`) are
**not** created by hand — the app declares them in `tagOwners` at provision time
(owned by `tag:p0rt1on`). The one exception is manual ACL mode
(`P0RT1ON_TAILSCALE_ACL_MODE=manual`, step 3): with no policy-write access the
app can't declare the serve tag, so create `p0rt1on-serve` (owner `tag:p0rt1on`)
here too.

### 2. Generate the OAuth client

**Settings → `+ Credential` → OAuth Client.** Set **Policy File**, **Devices →
Core**, and **Keys → Auth Keys** to **Write** (Write includes Read); set **DNS**
and **Settings → Networking Settings** to **Read**; **Users** is an optional
**Read** (see the note below); leave every other permission at **No access**.
The rows below follow the console's own order — its **General** section holds
DNS, Policy File, then Users, while Devices, Keys, and Settings are their own
sections:

| Permission                         | Access    | Tag           | Why                                                            |
| ---------------------------------- | --------- | ------------- | -------------------------------------------------------------- |
| **DNS**                            | **Read**  | _(none)_      | read tailnet DNS preferences — MagicDNS on/off (`magicDNS`)    |
| **Policy File**                    | **Write** | _(none)_      | read + edit the ACL (per-friend grant + tagOwners)             |
| **Users** _(optional)_             | **Read**  | _(none)_      | detect when an email-invited friend accepts (status reconcile) |
| **Devices → Core**                 | **Write** | `tag:p0rt1on` | list friend nodes (online state) + delete on suspend/offboard  |
| **Keys → Auth Keys**               | **Write** | `tag:p0rt1on` | mint + revoke each friend's auth key                           |
| **Settings → Networking Settings** | **Read**  | _(none)_      | read tailnet settings — HTTPS certs on/off (`httpsEnabled`)    |

Tailscale requires a tag on **Devices → Core** and **Keys → Auth Keys** — set
both to **`tag:p0rt1on`**; **Policy File**, **Users**, **DNS**, and **Networking
Settings** take no tag. Then **Generate** and copy the **client secret** (shown
once) → this is `P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET`.

#### Email invites (optional)

OAuth clients can't create Tailscale invites — Tailscale restricts invites to
user-owned tokens. To send invites, set a personal token
`P0RT1ON_TAILSCALE_API_TOKEN` (`tskey-api-…`). These tokens expire within 90
days, but you only need a valid one at the moment you create the portion —
that's when the invite is sent. It doesn't matter if it expires afterward. The
optional **Users → Read** scope above lets the OAuth client detect when a friend
accepts their invite; without it, P0RT1ON checks devices instead. Auth-key
onboarding needs neither.

#### Security limitation on a shared tailnet

The **Policy File → Write** permission is broad: Tailscale does not let you
restrict _which_ ACL rules an OAuth client may create, so an OAuth client with
it can edit the **entire** tailnet policy. If this secret is compromised, an
attacker can write an ACL rule granting a P0RT1ON-generated key access to
**any** machine on your tailnet. P0RT1ON only ever writes narrow per-friend
rules, but Tailscale can't enforce that limit on the credential itself — so a
stolen secret can change anything in the policy.

**Recommendation:** if you have other machines on this tailnet, run P0RT1ON on a
**separate tailnet** (a separate Tailscale account). A fully compromised OAuth
client can then only affect the P0RT1ON tailnet — your personal machines aren't
on it at all. To share one tailnet instead, drop the Policy File permission and
manage the ACL by hand (see step 3).

### 3. Notes on Policy File permission

With the **Policy File** permission (step 2), P0RT1ON writes each friend's grant
automatically — skip to step 4.

If you do not grant Policy File write permission when generating your OAuth key,
you will be prompted to manually add the required ACLs to Tailscale when
creating a portion. Set `P0RT1ON_TAILSCALE_ACL_MODE=manual`, and on each add
P0RT1ON shows you the exact grant lines instead of writing them, for you to
paste into your policy. Two options:

**One rule for all friends** — they reach only the P0RT1ON serve nodes, and are
kept apart from each other by their MinIO credentials rather than the network:

```jsonc
{ "src": ["tag:p0rt1on-friend"], "dst": ["tag:p0rt1on-serve:443"] }
```

**One rule per friend** — full network isolation between friends too:

```jsonc
{ "src": ["tag:p0rt1on-friend-alice"], "dst": ["alice.<tailnet>:443"] }
```

You edit the policy by hand whenever friends change. In return, a leaked OAuth
client can only mint friend-tagged keys — it can never open new access on its
own.

### 4. Environment

Copy `.env.example` to `.env` (it's gitignored). Four values are required:

- `P0RT1ON_MASTER_KEY` — the master key.
- `P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET` — the OAuth client secret from step 2
  (the client secret, not a personal token).
- `P0RT1ON_TAILSCALE_TAG_OWNER` — the OAuth client's tag from step 1,
  `tag:p0rt1on`. New per-friend tags are created under it.
- `P0RT1ON_PANTRY` — the disk path where friend data is stored.

Your tailnet's MagicDNS name is no longer configured — each friend's serve URL
is read live from its node's FQDN via the Tailscale API.

Two settings are optional:

- `P0RT1ON_TAILSCALE_ACL_MODE=manual` — set this if you dropped the Policy File
  permission in step 3, so P0RT1ON surfaces ACL grants for you to paste instead
  of writing them itself.
- `P0RT1ON_TAILSCALE_API_TOKEN` — a `tskey-api-…` personal token that enables
  email invites.

Every setting is documented in `.env.example` itself. To run the manager locally
for development, see [`DEV.md`](DEV.md).

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
- **Activity:** MinIO audit webhooks → manager (`/internal/minio-events`),
  aggregated into per-friend stats. Usage sampled via `mc du`. Set
  `P0RT1ON_MINIO_FORWARD_URL` to also forward every event, byte-identical, to
  your own webhook.

---

See [`PLAN.md`](PLAN.md) for the full architecture and design rationale.
