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

## Local testing without a tailnet

Set `SKIP_TAILSCALE=1` and point `S3_ENDPOINT` at a reachable MinIO (e.g.
[`../deploy/docker-compose.yml`](../deploy/docker-compose.yml)) to exercise
validate → connect/create → snapshot without Tailscale.
