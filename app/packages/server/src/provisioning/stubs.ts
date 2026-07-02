import { NotImplementedError } from "../lib/ServiceError.ts";
import type { TailscaleApi } from "../tailscale/tailscale.ts";

// ============================================================================
// Placeholder for the one external still pending real wiring: Tailscale (its
// ACL/serve pieces + a real tailnet). Every method throws NOT_IMPLEMENTED
// (→ HTTP 501), so add/offboard fail loudly at that step rather than silently
// no-op. mc / runtime / smoke are now real impls (see app.ts).
// ============================================================================

/** Returns an object whose every method throws NotImplementedError. */
function notImplemented<T>(name: string): T {
  return new Proxy({}, {
    get: (_target, prop) => () => {
      throw new NotImplementedError(`${name}.${String(prop)} not implemented`);
    },
  }) as unknown as T;
}

export const stubTailscale: TailscaleApi = notImplemented("TailscaleApi");
