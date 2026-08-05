# p0rt1on backup-client

A one-shot backup runner for a p0rt1on friend: brings up Tailscale (userspace),
connects to (or creates) your [Kopia](https://kopia.io) repo, snapshots a
mounted directory into your bucket, and exits. Configured entirely by env vars.

Friend-facing runbook (bundle contents, zero-knowledge note): the **How to be a
client** section of the [top-level README](../README.md).

## Build

```bash
docker build -t p0rt1on-backup-client backup-client/
# cross-arch (building on arm64 for an amd64 host):
docker build --platform linux/amd64 -t p0rt1on-backup-client backup-client/
```

Built on stock `tailscale/tailscale`, bundling the static `kopia` binary.

## Run

```bash
cp backup-client/.env.example backup.env   # fill in from your bundle
docker run --rm \
  --env-file backup.env \
  -v /my/data:/data:ro \   # -> BACKUP_PATH=/data
  p0rt1on-backup-client
```

Optional volumes:

- `-v p0rt1on-ts:/var/lib/tailscale` — persist the tailnet node across runs
  (auth key is single-use).
- `-v p0rt1on-cache:/cache` with `KOPIA_CACHE_DIRECTORY=/cache` — speed up
  repeat runs.

See [`.env.example`](.env.example) for all variables.

## Completion hooks

Two optional ways to be told a run finished. Both fire on **success and
failure** — a backup that silently stops running is the case worth hearing about
— and neither can fail the backup, since a notifier being down is not a backup
failure. Both also fire when a run dies before it ever reaches a snapshot, e.g.
it couldn't reach your bucket.

### A URL

`BACKUP_HOOK_URL` gets a JSON POST. `BACKUP_HOOK_BODY` sets the payload, with
`{status}` (`ok`/`failed`), `{exit_code}`, `{bucket}`, `{host}` and
`{duration_s}` substituted. Omit it for a generic p0rt1on payload.

Telegram takes this shape directly, so no relay is needed:

```bash
BACKUP_HOOK_URL=https://api.telegram.org/bot<TOKEN>/sendMessage
BACKUP_HOOK_BODY={"chat_id":"<CHAT_ID>","text":"backup {status}: {bucket} in {duration_s}s"}
```

Note the bot token sits in the URL, so it reaches `wget`'s argv and is visible
in `ps` **inside this container**. Everyone who can read that already holds your
bucket credentials, so it grants nothing new — but it is worth knowing.

### A script

Mount an executable at `/hooks/on-complete` (or point `BACKUP_HOOK_SCRIPT`
elsewhere) for anything a URL can't express:

```bash
docker run --rm --env-file backup.env \
  -v /my/data:/data:ro -v /my/notify.sh:/hooks/on-complete:ro \
  p0rt1on-backup-client
```

It runs with `BACKUP_STATUS`, `BACKUP_EXIT_CODE`, `BACKUP_BUCKET`,
`BACKUP_HOST`, `BACKUP_PATH`, `BACKUP_STARTED_AT` and `BACKUP_DURATION_S`.
Everything else is scrubbed, so a hook never sees `KOPIA_PASSWORD`, your S3
secret or your auth key: a notifier copied off the internet must not be handed
the keys to the repository it reports on.

Give the hook its own credentials by prefixing them `HOOK_` — those are
forwarded, nothing else is:

```bash
HOOK_TELEGRAM_TOKEN=...
HOOK_NTFY_PASSWORD=...
```

Unlike the URL above this keeps a token in the environment rather than on a
command line, so it never reaches `ps`.

## Local testing without a tailnet

Set `SKIP_TAILSCALE=1` and point `S3_ENDPOINT` at a reachable MinIO (e.g.
[`../deploy/docker-compose.yml`](../deploy/docker-compose.yml)) to exercise
validate → connect/create → snapshot without Tailscale.
