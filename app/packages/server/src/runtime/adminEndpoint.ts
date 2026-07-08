import { containerNames } from "./names.ts";
import type { McTarget } from "../minio/mc.ts";

// ============================================================================
// SINGLE source of the admin-plane MinIO endpoint (mc: provisioning, smoke
// test, du, webhook config). Two addressing modes, because published host
// ports and `host.docker.internal` cannot coexist on Linux: a container
// publishing to `127.0.0.1:<port>` is unreachable from another container via
// the host gateway — so a containerized manager must address instances by
// container NAME over the shared docker network instead.
// ============================================================================

/**
 * `host` — the manager runs on the host and reaches the loopback-published
 * port. `network` — the manager is itself a container on the instances'
 * docker network and reaches them by container name (the friend-side path is
 * Tailscale either way and unaffected).
 */
export type InstanceAddressing = "host" | "network";

/** Compose the admin endpoint for one instance under the given mode. */
export function adminEndpointComposer(
  mode: InstanceAddressing,
): (target: McTarget) => string {
  if (mode === "network") {
    // MinIO listens on the same port inside the container as it publishes.
    return (t) => `http://${containerNames(t.alias).container}:${t.minioPort}`;
  }
  return (t) => `http://127.0.0.1:${t.minioPort}`;
}
