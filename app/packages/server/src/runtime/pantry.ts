import { isAbsolute, join, relative, SEPARATOR } from "@std/path";
import { ServiceError } from "../lib/ServiceError.ts";

// ============================================================================
// The pantry: the one admin-chosen host directory that holds every friend's
// MinIO data, one subdirectory per instance ($PANTRY/<instance>). Tailscale
// node state deliberately lives elsewhere (a docker named volume) — the pantry
// is friend backup data only, so `du -sh $PANTRY/*` is true per-friend usage.
// Docker-runtime only; nothing above the InstanceRuntime seam knows it exists.
// ============================================================================

export interface Pantry {
  /** Absolute host path bind-mounted at /data for this instance. */
  dataDir(instanceHost: string): string;
  /** Create the instance's directory before `docker run`; idempotent. */
  ensure(instanceHost: string): Promise<void>;
  /** `rm -rf` the instance's directory; "already absent" is success. */
  remove(instanceHost: string): Promise<void>;
}

/** True if `<root>/<name>` is not exactly one level directly inside `root`. */
function escapes(root: string, name: string): boolean {
  const rel = relative(root, join(root, name));
  return rel.length === 0 || rel.startsWith("..") || isAbsolute(rel) ||
    rel.includes(SEPARATOR);
}

/**
 * friendNameSchema already constrains instance names — this is the
 * belt-and-braces assertion run before any mount or recursive delete, so a
 * name like `..` or `/etc` can never resolve outside the pantry root.
 */
function scoped(root: string, instanceHost: string): string {
  if (escapes(root, instanceHost)) {
    throw new ServiceError(
      "INTERNAL_SERVER_ERROR",
      `instance name "${instanceHost}" escapes the pantry`,
    );
  }
  return join(root, instanceHost);
}

export class HostPantry implements Pantry {
  constructor(private readonly root: string) {}

  dataDir(instanceHost: string): string {
    return scoped(this.root, instanceHost);
  }

  ensure(instanceHost: string): Promise<void> {
    // 0700: the instance image's MinIO (running as root) is the only reader.
    return Deno.mkdir(this.dataDir(instanceHost), {
      recursive: true,
      mode: 0o700,
    });
  }

  remove(instanceHost: string): Promise<void> {
    // dataDir() asserts containment BEFORE the recursive delete.
    return Deno.remove(this.dataDir(instanceHost), { recursive: true })
      .catch((err) => {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      });
  }
}
