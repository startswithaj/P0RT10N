import type { TailscaleApi } from "./tailscale.ts";
import { ServiceError } from "../lib/ServiceError.ts";

// Friend-facing serve URL, resolved LIVE from the tailnet node (used by
// provisioning and the read side). http mode uses the node's tailnet IP (works
// with MagicDNS off); https uses the node's MagicDNS FQDN (what the cert covers).
// Throws if the node isn't on the tailnet — a missing node is a genuine
// inconsistency, not papered over with a composed guess.

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
