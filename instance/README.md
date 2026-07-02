# p0rt1on instance image

One long-running container that runs **both MinIO and tailscaled**. The manager
launches one of these per dedicated friend, and one for the shared pool.

- **tailscaled** (userspace) joins the tailnet tagged `tag:p0rt1on-serve` and
  `tailscale serve`s MinIO at `https://<TS_HOSTNAME>.<tailnet>.ts.net`.
- **MinIO** runs in the same container, so serve reaches it over `localhost`.
- **Admin plane vs data plane:** the manager reaches MinIO for `mc admin` over
  the docker network (`http://<container>:9000`); friends reach it only over
  Tailscale.
- **Health:** the image's `HEALTHCHECK` is green only when tailscaled is
  connected **and** MinIO is live — read by the manager via
  `docker inspect .State.Health.Status`.

## Build

```bash
docker build -t p0rt1on-instance instance/
```

## Env (set by the manager)

| Var                   | Required | Purpose                                                        |
| --------------------- | -------- | -------------------------------------------------------------- |
| `TS_AUTHKEY`          | yes      | the instance's serve auth key (`tag:p0rt1on-serve`)            |
| `TS_HOSTNAME`         | yes      | the tailnet hostname → the friend's endpoint                   |
| `MINIO_ROOT_USER`     | yes      | MinIO root user (admin plane only)                             |
| `MINIO_ROOT_PASSWORD` | yes      | MinIO root password                                            |
| `TS_TAG`              | no       | advertise tag (default none; manager sets `tag:p0rt1on-serve`) |
| `MINIO_PORT`          | no       | MinIO port (default `9000`)                                    |
| `DATA_DIR`            | no       | data dir (default `/data`; mount a volume here)                |

## Volumes

- `/data` — MinIO object data (one named volume per instance)
- `/var/lib/tailscale` — tailnet identity/state (persists the node across
  restarts)
