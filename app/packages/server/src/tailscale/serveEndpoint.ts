import type { TailscaleApi } from "./tailscale.ts";
import { ServiceError } from "../lib/ServiceError.ts";

// ============================================================================
// The friend-facing serve URL, resolved LIVE from the tailnet node (one place,
// used by both provisioning and the read side). http mode addresses the node by
// its tailnet IP (no MagicDNS-bound cert, so it works with MagicDNS off); https
// mode uses the node's real MagicDNS FQDN (what the cert is issued for). Throws
// if the node isn't on the tailnet yet — the manager provisions the serve node
// and waits for it, so a missing node is a genuine inconsistency, not a normal
// state to paper over with a composed guess.
// ============================================================================

export async function serveEndpoint(
  tailscale: Pick<TailscaleApi, "nodeIpv4" | "nodeFqdn">,
  serveMode: "https" | "http",
  tsHostname: string,
): Promise<string> {
  if (serveMode === "http") {
    const ip = await tailscale.nodeIpv4(tsHostname);
    if (!ip) {
      throw new ServiceError(
        "INTERNAL_SERVER_ERROR",
        `instance ${tsHostname} has no tailnet IP yet`,
      );
    }
    return `http://${ip}`;
  }
  const fqdn = await tailscale.nodeFqdn(tsHostname);
  if (!fqdn) {
    throw new ServiceError(
      "INTERNAL_SERVER_ERROR",
      `instance ${tsHostname} has no MagicDNS name yet`,
    );
  }
  return `https://${fqdn}`;
}
