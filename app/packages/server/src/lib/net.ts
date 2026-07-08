// ============================================================================
// Host-port probing for allocation. The DB only knows which ports IT handed
// out — a foreign process squatting on an in-range port would otherwise make
// allocation re-pick the same busy port forever. Injectable so repo tests
// drive "busy" without real sockets.
// ============================================================================

/** True when `port` can be bound (free) on the publish interface. */
export type PortProbe = (port: number) => boolean;

/**
 * Probe by bind: open + immediately close a listener. Deno.listen is
 * synchronous, so this can run inside the reserve transaction. Best-effort by
 * design — something can grab the port between probe and `docker run`; the
 * run failure then surfaces and a retry advances past it.
 */
export function denoPortProbe(hostname = "127.0.0.1"): PortProbe {
  return (port) => {
    try {
      const listener = Deno.listen({ hostname, port });
      listener.close();
      return true;
    } catch {
      return false;
    }
  };
}
