import type { TailscaleApi } from "./tailscale.ts";
import { ServiceError } from "../lib/ServiceError.ts";

// Resolves the friend-facing serve URL LIVE from the node. In http mode it uses
// the tailnet IP, which works with MagicDNS off; in https mode it uses the
// MagicDNS FQDN, which is what the cert covers.

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
