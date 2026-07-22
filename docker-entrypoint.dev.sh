#!/bin/sh
# Runs both halves of the app in the one manager container: the Vite dev server
# (frontend) in the background and the Deno manager (backend) in the foreground
# as PID 1's child. Vite proxies /trpc and /health to the backend on
# 127.0.0.1:8080 within this container, so no cross-container networking needed.
set -e

# Frontend dev server (Vite on 0.0.0.0:5173, published via the compose mapping).
deno task dev:web &

# Backend manager API — the main process. `--watch` restarts it on any source
# change under the live-mounted repo (dev only), so the backend hot-reloads like
# Vite does for the frontend. It watches the import graph, not the SQLite file,
# so DB writes don't trigger restarts.
exec deno run --watch \
  --allow-read --allow-write --allow-env --allow-ffi --allow-net --allow-run \
  --unstable-ffi app/packages/server/src/main.ts
