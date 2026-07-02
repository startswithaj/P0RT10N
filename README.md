# p0rt1on

**An orchestrator + web UI for [MinIO](https://min.io) and
[Tailscale](https://tailscale.com) that makes sharing storage with your friends
easy.**

> **Securely share some storage with friends.** Self-hosted · Multi-tenant S3 ·
> Over Tailscale

## What it is

Lend portions of your disk to friends as offsite backup targets, managed from a
web UI. Each friend gets their **own S3 bucket** (their size cap, their access
key) reachable **only** over their **own Tailscale endpoint**.

Everything p0rt1on does is doable by hand with `mc` and `tailscaled` — minting
auth keys, provisioning MinIO, setting quotas and Object Lock, wiring up
`tailscale serve`. p0rt1on is the orchestration + UI on top, so adding a friend
is a form instead of a runbook.

## Why it exists

To run offsite backups for friends on a home Kubernetes cluster. Lend storage,
hand over a bundle, let each friend back up into a bucket only they can reach.

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
- **Two enrollment modes, both handled by the app.** Either **mint an auth key**
  (pre-authorized, single-use, pre-tagged; redeemed with
  `tailscale up --authkey=…`, headless, no account) or **invite to the tailnet**
  by email (friend joins with their own identity). You pick in the UI; p0rt1on
  does the Tailscale API work.
- **Ransomware-resistant.** MinIO **Object Lock** keeps recent objects immutable
  even to whoever holds the friend's credentials, so a compromised client can't
  encrypt, tamper with, or wipe the backups. A **hard quota** caps each portion.
- **Runs on any container runtime** — Docker, Podman, Kubernetes.

## Requirements

- A container runtime (Docker/Podman/k8s) — the manager launches stock
  `minio/minio` + `tailscale/tailscale` containers per friend.
- A Tailscale account + API access (tailnet + API key/OAuth client) to mint auth
  keys / send invites.
- Disk space for the sum of the portions you hand out — one filesystem is fine;
  quotas keep friends apart.
- A volume for the manager's SQLite DB (metadata only, no secrets).

### Details

- **No dedicated disk.** Each per-friend MinIO runs single-node single-drive
  (`minio server /data`); `/data` is a **directory on a volume** (named volume,
  host path, or PVC), not a raw device. Portions are sized by **hard quota**,
  not partitioning, so friends share one filesystem.
- **Stock images, launched at runtime.** You don't build MinIO or Tailscale; the
  manager runs the pinned upstream images per friend.
- **Metadata only.** The manager's SQLite DB holds no secrets — friend bundles
  are shown once and never persisted.

## Setup — Tailscale OAuth client

p0rt1on calls the Tailscale API on **every** add / suspend / offboard (mint the
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
secret** (shown once) → this is `TS_API_TOKEN`.

> **⚠️ Security limitation — read this before using a shared tailnet.** The
> **Policy File → Write** permission is broad. Tailscale does **not** let you
> restrict _which_ ACL rules an OAuth client may create, so a client with this
> permission can edit the **entire** tailnet policy. In practice this means:
> **if this client's secret is compromised, an attacker can write an ACL rule
> that grants a p0rt1on-generated key access to _any_ machine on your tailnet.**
> p0rt1on itself only ever writes narrow per-friend rules — but Tailscale can't
> _enforce_ that limit on the credential, so the credential is as powerful as
> the whole policy file.
>
> **Recommendation:** if you have other machines on this tailnet, run p0rt1on on
> a **separate tailnet (a separate Tailscale account)**. Then even a fully
> compromised client can only affect the p0rt1on tailnet — your personal
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
the **Policy File** permission when creating the client. p0rt1on then can't edit
the ACL, so you write the per-friend grants yourself — either one static rule
for all friends:

```jsonc
{ "src": ["tag:p0rt1on-friend"], "dst": ["tag:p0rt1on-serve:443"] }
```

(friends reach only p0rt1on serve nodes; isolated from each other by MinIO
credentials, not the network), or one rule per friend for full network
isolation:

```jsonc
{ "src": ["tag:p0rt1on-friend-alice"], "dst": ["alice.<tailnet>:443"] }
```

The trade-off is a manual ACL edit when isolation rules change; the win is that
a leaked client can only mint friend-tagged keys — never grant them new reach.

### 4. Environment

| Var              | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `TS_API_TOKEN`   | the OAuth client **secret** (`tskey-client-…`)                                                  |
| `TS_TAILNET`     | your tailnet name (e.g. `tailXXXX.ts.net`), or `-`                                              |
| `TS_TAG_OWNER`   | `tag:p0rt1on`                                                                                   |
| `TAILNET_DOMAIN` | your MagicDNS base (e.g. `tailXXXX.ts.net`) — used to build `https://<name>.<domain>` endpoints |

Put these in `.env` (gitignored — see `.env.example`). Without `TS_API_TOKEN`
the manager boots with a Tailscale **stub**: it runs, but provisioning fails
loudly at the Tailscale steps.

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

---

See [`PLAN.md`](PLAN.md) for the full architecture and design rationale.
