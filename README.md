# P0RT1ON

**Lend your mates a slice of your disk as an offsite S3 backup target they can't
wreck.**

Self-hosted · Runs over Tailscale · Nothing on the public internet

## What it is

A web UI on top of [MinIO](https://min.io) and
[Tailscale](https://tailscale.com). You add a friend in a form, and they get:

- their own S3 bucket, with a size cap and their own access key
- their own Tailscale endpoint — nobody else can reach it
- Object Lock on recent backups, so even someone holding their key can't delete
  or encrypt them

You could do all of this by hand with `mc` and `tailscaled` — mint an auth key,
provision MinIO, set the quota and Object Lock, wire up `tailscale serve`.
P0RT1ON turns that into a GUI.

## Why it exists

I wanted to run offsite backups for friends off a home server. Lend them some
disk, hand over a set of credentials, and let them get on with it.

You never see what they store. Your server only holds the bytes their client
uploads — if they encrypt before sending (Kopia does by default), it's
ciphertext you can't open. The password only ever exists on their machine.

Kopia is the recommendation, but any S3 client works.

## How it works

**Each friend is isolated.** They get their own MinIO + tailscaled pair, on
their own endpoint. Or they can share one pool, where MinIO credentials and
Tailscale ACLs keep the buckets apart. Both work in the same install.

**Nothing is exposed to the internet.** It all runs over Tailscale — no open
ports, no port forwarding, no home IP out in the open. There's nothing public to
scan or attack.

**Two ways to get them on.** By default they redeem a single-use auth key with
`tailscale up --authkey=…` and don't need a Tailscale account at all. Or, if you
set a personal API token, P0RT1ON emails them a Tailscale invite and they join
with their own account. Either way P0RT1ON creates, scopes and revokes the
access for you.

**Backups can't be wiped.** MinIO Object Lock (GOVERNANCE) keeps recent objects
immutable, and friend credentials are explicitly denied the ability to bypass
it. So if their machine gets ransomwared, the attacker can't encrypt, change or
delete what's already backed up.

**You can't read their data.** Their S3 secret and Tailscale auth key only exist
while the request is running — shown once in the UI, never written to the
database, cache or logs. The database holds metadata only. Each instance's MinIO
root password is derived from `P0RT1ON_MASTER_KEY` rather than stored anywhere.

**Everything from the dashboard.** Add, resize, rotate a key, suspend, resume,
offboard. Usage is sampled per bucket and activity comes from MinIO audit
webhooks posted back to the manager — no Prometheus, and nothing to install on
the friend's machine.

**Runs anywhere.** Docker, Podman or Kubernetes.

## What you need

- **A container runtime** — Docker, Podman or Kubernetes. The manager launches
  one MinIO + tailscaled container per friend.
- **A Tailscale account with API access** (a tailnet and an OAuth client) — see
  [Setting up Tailscale](#setting-up-tailscale).
- **Disk space** for everything you hand out. One filesystem is fine. Each MinIO
  runs single-drive against a directory on a volume (a named volume, host path
  or PVC — not a raw device), and portions are capped by quota rather than
  partitioning, so friends can share the same disk.
- **A volume for the manager's database.** SQLite, metadata only, no secrets in
  it.

**Budget a bit more disk than you hand out.** Space used is roughly 1:1 with the
quota — MinIO runs single-drive with no erasure parity — plus any locked
versions of objects that have been superseded but haven't hit their retention
expiry yet.

**Back up your master key.** `P0RT1ON_MASTER_KEY` derives the root password for
every instance, so it has to stay the same. Lose it or change it and you lose
admin access to every instance you've created. Keep it in a password manager,
and never commit it.

## Quick start

```bash
cp .env.example .env   # fill in the required values, the rest have defaults
docker compose up
```

The admin UI is at `http://127.0.0.1:5173`. The API binds to loopback only on
`:8080` — friends never reach it, and neither does the tailnet.

The manager needs the Docker socket mounted, since it launches the instance
containers, plus two volumes: one for the database and one for `mc` aliases. The
included `docker-compose.yml` sets all that up, including the path audit
webhooks take from the instances back to the manager.

Four settings are required and the manager won't start without them — it won't
fall back to defaults or run half-configured. They're the master key, the OAuth
client secret, the OAuth client's tag, and the pantry (where friend data lives).
`.env.example` explains each one.

## Running on Kubernetes

The manager can run in-cluster and provision each portion as a StatefulSet
instead of a Docker container. Everything lives in one namespace, and the
manager only gets permissions inside it.

Images are published to GHCR on release:

```
ghcr.io/startswithj/p0rt1on-manager
ghcr.io/startswithj/p0rt1on-instance
```

### The pantry

The pantry is where friend data lands. On Kubernetes it's a StorageClass — each
time you add a friend, the manager creates a PVC for their data from it. Set it
with `P0RT1ON_PANTRY`.

Any `ReadWriteOnce` class works, as long as it provisions dynamically. If it
can't, every new friend sits Pending until you hand-write a PV for them. Worth
knowing if you're using local disk: core Kubernetes can mount a directory on a
node, but nothing in it creates those volumes for you. You need a provisioner —
Rancher's local-path is the simplest, or TopoLVM if you want LVM-backed volumes
with real size limits.

Note `reclaimPolicy`: offboarding a friend deletes their volume, so with
`Delete` the data goes too. Use `Retain` if you want that reversible.

Use a dedicated class, not your general-purpose one. The pantry is friend data
only — the manager's own database sits on a separate PVC from the cluster
default class.

### The manifest

```yaml
# The pantry: a directory-per-volume class using Rancher's local-path
# provisioner. Install it first if your cluster doesn't have it. The directory
# it writes to is set in the provisioner's own local-path-config ConfigMap.
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: p0rt1on-pantry
provisioner: rancher.io/local-path
reclaimPolicy: Delete
# These volumes are node-local, so bind only once a pod needs one — it has to
# land on whichever node runs that portion.
volumeBindingMode: WaitForFirstConsumer
---
apiVersion: v1
kind: Namespace
metadata:
  name: p0rt1on
  labels:
    pod-security.kubernetes.io/enforce: restricted
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: p0rt1on-manager
  namespace: p0rt1on
---
# The manager's entire permission surface. Nothing cluster-scoped, no RBAC
# verbs, powerless outside this namespace.
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: p0rt1on-manager
  namespace: p0rt1on
rules:
  - apiGroups: ["apps"]
    resources: ["statefulsets"]
    verbs: ["get", "list", "create", "patch", "delete"]
  - apiGroups: [""]
    resources: ["services", "secrets", "persistentvolumeclaims"]
    verbs: ["get", "create", "patch", "delete"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: p0rt1on-manager
  namespace: p0rt1on
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: p0rt1on-manager
subjects:
  - kind: ServiceAccount
    name: p0rt1on-manager
    namespace: p0rt1on
---
apiVersion: v1
kind: Secret
metadata:
  name: p0rt1on-manager-secrets
  namespace: p0rt1on
stringData:
  P0RT1ON_MASTER_KEY: "..."
  P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET: "..."
  P0RT1ON_TAILSCALE_TAG_OWNER: "tag:p0rt1on"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: p0rt1on-manager-data
  namespace: p0rt1on
spec:
  # No storageClassName on purpose: the manager's database uses the cluster
  # default, never the pantry. The pantry holds friend data only.
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 1Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: p0rt1on-manager
  namespace: p0rt1on
spec:
  replicas: 1
  selector:
    matchLabels: { app: p0rt1on-manager }
  template:
    metadata:
      labels: { app: p0rt1on-manager }
    spec:
      serviceAccountName: p0rt1on-manager
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: manager
          image: ghcr.io/startswithj/p0rt1on-manager:latest
          envFrom:
            - secretRef: { name: p0rt1on-manager-secrets }
          env:
            - name: P0RT1ON_RUNTIME
              value: kubernetes
            - name: P0RT1ON_K8S_NAMESPACE
              value: p0rt1on
            - name: P0RT1ON_INSTANCE_IMAGE
              value: ghcr.io/startswithj/p0rt1on-instance:latest
            - name: P0RT1ON_PANTRY
              value: p0rt1on-pantry
            - name: P0RT1ON_DB_PATH
              value: /data/p0rt1on.db
            # Deno reads this PEM to trust the cluster CA on API calls.
            - name: DENO_CERT
              value: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
          ports:
            - containerPort: 8080 # admin UI and API
            - containerPort: 8081 # audit webhooks from the instances
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: p0rt1on-manager-data }
---
# Instances post audit events here. The admin API on 8080 is deliberately not
# in this Service — port-forward to reach it.
apiVersion: v1
kind: Service
metadata:
  name: p0rt1on-manager
  namespace: p0rt1on
spec:
  selector: { app: p0rt1on-manager }
  ports:
    - name: audit
      port: 8081
      targetPort: 8081
```

The admin API isn't meant to be exposed — no Ingress, no LoadBalancer. Port
forward to it:

```bash
kubectl -n p0rt1on port-forward deploy/p0rt1on-manager 8080:8080
```

## Setting up Tailscale

P0RT1ON calls the Tailscale API every time you add, suspend or offboard a friend
— minting their auth key, scoping their ACL, deleting their node. Give it an
OAuth client rather than a personal API token: personal tokens are full-access
and expire within 90 days. You have to create it by hand in the admin console,
since the API can't create OAuth clients.

### HTTPS (recommended)

By default each instance is served over HTTPS, which needs your tailnet to issue
certificates. MagicDNS is on by default, certificates aren't:

1. Admin console → **DNS**
2. Under **HTTPS Certificates**, click **Enable HTTPS**

If you'd rather not, set `P0RT1ON_TAILSCALE_SERVE_MODE=http` and instances are
served as plain HTTP at their tailnet IP. Traffic is still encrypted — that's
Tailscale doing it rather than TLS.

Leave it on HTTPS if you can. Adding a friend will fail with _"Serve is not
enabled on your tailnet"_ if certificates are off and you haven't switched to
http mode.

### The tags

Tailscale identifies machines by tag, and the ACL is written in terms of them.
There are three:

- **`tag:p0rt1on`** — the OAuth client itself. You create this one by hand; it
  owns and mints the rest.
- **`tag:p0rt1on-serve`** — worn by each MinIO instance.
- **`tag:p0rt1on-friend-<name>`** — worn by each friend's machine.

P0RT1ON declares the last two itself when it provisions.

The friend and serve tags are what keep everyone apart. Each friend's ACL rule
reads `tag:p0rt1on-friend-alice → alice's instance`, so their machine can reach
their own instance and nothing else — not the manager, not anyone else's
instance. Auth keys are minted with the tag already on them, so a friend's
machine has its identity from the moment it joins.

### 1. Create the tag

The OAuth client's tag has to exist in the policy before the client can use it.
Admin console → **Access Controls** → **Tags** panel → **Create Tag**:

| Tag       | Owner             |
| --------- | ----------------- |
| `p0rt1on` | `autogroup:admin` |

That's the only one you make by hand. P0RT1ON declares the serve tag and each
friend tag itself, owned by this one.

(The exception is manual ACL mode — see step 3. With no policy write access
P0RT1ON can't declare the serve tag, so create `p0rt1on-serve` here too, owned
by `tag:p0rt1on`.)

### 2. Generate the OAuth client

**Settings** → **+ Credential** → **OAuth Client**. Set these, and leave
everything else on **No access**:

| Permission                     | Access | Tag           | What for                                                              |
| ------------------------------ | ------ | ------------- | --------------------------------------------------------------------- |
| DNS                            | Read   | —             | check whether MagicDNS is on                                          |
| Policy File                    | Write  | —             | write each friend's ACL rule and the tags                             |
| Users (optional)               | Read   | —             | spot when an emailed invite is accepted                               |
| Devices → Core                 | Write  | `tag:p0rt1on` | see if friend machines are online, delete them on suspend or offboard |
| Keys → Auth Keys               | Write  | `tag:p0rt1on` | mint and revoke friend auth keys                                      |
| Settings → Networking Settings | Read   | —             | check whether HTTPS certificates are on                               |

Write includes Read. Tailscale insists on a tag for **Devices → Core** and
**Keys → Auth Keys** — use `tag:p0rt1on` for both. The rest take no tag.

Hit **Generate** and copy the client secret. You only see it once. That's
`P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET`.

#### Email invites (optional)

By default a friend joins with an auth key P0RT1ON generates for them —
single-use, already tagged, and they don't need a Tailscale account at all. If
you'd rather invite them to your tailnet properly, so they join with their own
account, you can do that instead.

The catch: OAuth clients can't create Tailscale invites, only user-owned tokens
can. So set `P0RT1ON_TAILSCALE_API_TOKEN` to a personal token (`tskey-api-…`).

These expire within 90 days, but it only has to be valid at the moment you
create the portion, since that's when the invite goes out. It expiring
afterwards doesn't matter.

The optional **Users → Read** scope lets P0RT1ON notice when a friend accepts.
Without it, it watches for their device appearing instead. Auth-key onboarding
needs neither.

#### A warning if you share this tailnet

**Policy File → Write** is broader than it looks. Tailscale gives you no way to
limit which ACL rules a client may write, so this credential can edit your whole
policy. P0RT1ON only ever writes narrow per-friend rules, but nothing stops it
doing more — and if the secret leaks, an attacker can write a rule granting
access to any machine on your tailnet.

So if you have other machines on this tailnet, run P0RT1ON on a separate one (a
separate Tailscale account). Then a stolen secret only reaches the P0RT1ON
tailnet, and your own machines aren't on it.

If you'd rather share the one tailnet, drop the Policy File permission and
manage the ACL yourself — step 3.

### 3. If you skipped the Policy File permission

With Policy File write access, P0RT1ON writes each friend's ACL rule as you add
them. Nothing to do — skip to step 4.

Without it, set `P0RT1ON_TAILSCALE_ACL_MODE=manual`. Adding a friend then shows
you the lines to paste into your policy instead of writing them. Two ways to do
it:

**One rule for everyone.** Friends can reach the P0RT1ON instances and nothing
else, and are kept apart by their MinIO credentials rather than by the network:

```jsonc
{ "src": ["tag:p0rt1on-friend"], "dst": ["tag:p0rt1on-serve:443"] }
```

**One rule each.** Friends are isolated from each other on the network too:

```jsonc
{ "src": ["tag:p0rt1on-friend-alice"], "dst": ["alice.<tailnet>:443"] }
```

You're editing the policy by hand every time a friend comes or goes. What you
get for it: a leaked OAuth client can only mint friend-tagged keys, and can
never open up access on its own.

### 4. Environment

Copy `.env.example` to `.env` — it's gitignored, and documents the settings
worth knowing about. Four are required:

- `P0RT1ON_MASTER_KEY` — your master key
- `P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET` — the client secret from step 2
- `P0RT1ON_TAILSCALE_TAG_OWNER` — `tag:p0rt1on`, from step 1. New friend tags
  get created under it.
- `P0RT1ON_PANTRY` — where friend data goes

And two optional ones we've already covered:

- `P0RT1ON_TAILSCALE_ACL_MODE=manual` — if you skipped Policy File write
- `P0RT1ON_TAILSCALE_API_TOKEN` — if you want email invites

To run the manager locally for development, see [`DEV.md`](DEV.md).

### Logging in

No login by default. The admin API binds to `127.0.0.1`, so only this machine
can reach it.

To require a username and password, set both:

```bash
P0RT1ON_ADMIN_USERNAME=you
P0RT1ON_ADMIN_PASSWORD=something-long
```

Set them if you move `P0RT1ON_ADMIN_BIND_HOST` off loopback or expose the port
any other way. The manager warns at startup if it's bound wide with no password,
though it can't see a container's host publish.

The password is hashed at boot, plaintext dropped. Sessions are in-memory and
last 7 days, so a restart logs you out.

## What your friends do

Their end is just Tailscale and Kopia. They can run the commands directly, or
use the [`backup-client`](backup-client/) image that wraps both.

The bundle you give them has the S3 endpoint, bucket, access key and secret, and
a Tailscale auth key. The one thing they choose themselves is `KOPIA_PASSWORD` —
their encryption key. It never leaves their machine, and if they lose it their
backups are gone. You can't help them; you only ever hold ciphertext.

### By hand

With [Tailscale](https://tailscale.com/download) and
[Kopia](https://kopia.io/docs/installation/) installed:

```bash
# join the tailnet
tailscale up --authkey=tskey-auth-xxxxxxxxxxxx

# create the repo — first time only. --endpoint is host[:port], no https://
export KOPIA_PASSWORD='something-strong'
kopia repository create s3 \
  --bucket=alice \
  --endpoint=alice.tailnet-xxxx.ts.net \
  --access-key=AKIAxxxxxxxxxxxx \
  --secret-access-key=xxxxxxxxxxxxxxxxxxxxxxxx \
  --retention-mode=GOVERNANCE --retention-period=30d

# back up — incremental, run it as often as you like
kopia snapshot create /my/data
```

Every run after that is `kopia repository connect s3 …` with the same flags
minus retention, then `kopia snapshot create`.

### With Docker

The image joins the tailnet, connects to the repo (creating it if needed),
snapshots the mounted directory, and exits.

```bash
cp backup-client/.env.example backup.env   # bundle values + KOPIA_PASSWORD
docker run --rm \
  --env-file backup.env \
  -v /my/data:/data:ro \   # -> BACKUP_PATH=/data
  ghcr.io/startswithj/p0rt1on-backup-client:latest
```

Two volumes worth adding: `-v p0rt1on-ts:/var/lib/tailscale` keeps the tailnet
machine between runs, since the auth key is single-use, and
`-v p0rt1on-cache:/cache` with `KOPIA_CACHE_DIRECTORY=/cache` speeds up repeat
runs. [`backup-client/README.md`](backup-client/README.md) has the rest.

## Under the hood

- **Manager** — Deno, tRPC API, SolidJS dashboard, SQLite via Drizzle for
  metadata. Shells out to `mc` and `docker`, both stock upstream images, pinned.
- **Instance** — one container running MinIO and tailscaled together, published
  at `https://<name>.<tailnet>.ts.net` by `tailscale serve`.
- **Activity** — MinIO audit webhooks post to the manager on
  `/internal/minio-events` and get aggregated per friend. Usage comes from
  `mc du`. Set `P0RT1ON_MINIO_FORWARD_URL` to forward every event on to your own
  webhook, byte for byte.
