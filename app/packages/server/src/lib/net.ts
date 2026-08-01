// The DB only tracks ports it issued, so probing catches a foreign process
// squatting in-range that would otherwise make allocation re-pick it forever.

export type PortProbe = (port: number) => boolean;

/**
 * Deno.listen's synchronous bind+close lets this probe run inside the reserve
 * transaction; a retry recovers if the port is grabbed before `docker run`.
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
