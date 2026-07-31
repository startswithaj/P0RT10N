import { containerNames } from "./names.ts";
import type { McTarget } from "../minio/mc.ts";

// A `127.0.0.1:<port>` publish is unreachable from another container, so a
// containerized manager addresses instances by container NAME.

/** With `host` the manager runs on the host and reaches the loopback-published
 * port; with `network` the manager is a container on the shared docker network
 * and addresses by name. The friend path is Tailscale either way. */
export type InstanceAddressing = "host" | "network";

export function adminEndpointComposer(
  mode: InstanceAddressing,
): (target: McTarget) => string {
  if (mode === "network") {
    // MinIO listens on the same port inside the container as it publishes.
    return (t) => `http://${containerNames(t.alias).container}:${t.minioPort}`;
  }
  return (t) => `http://127.0.0.1:${t.minioPort}`;
}
