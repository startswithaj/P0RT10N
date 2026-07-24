import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { serveEndpoint } from "./serveEndpoint.ts";

describe("serveEndpoint", () => {
  const ts = (over: Partial<{
    nodeIpv4: (h: string) => Promise<string | null>;
    nodeFqdn: (h: string) => Promise<string | null>;
  }> = {}) => ({
    nodeIpv4: over.nodeIpv4 ?? (() => Promise.resolve("100.64.0.9")),
    nodeFqdn: over.nodeFqdn ??
      ((h: string) => Promise.resolve(`${h}.tailXXXX.ts.net`)),
  });

  it("https uses the node's live MagicDNS FQDN", async () => {
    expect(await serveEndpoint(ts(), "https", "p0rt1on-alice")).toBe(
      "https://p0rt1on-alice.tailXXXX.ts.net",
    );
  });

  it("http addresses the node by its tailnet IP", async () => {
    expect(await serveEndpoint(ts(), "http", "p0rt1on-alice")).toBe(
      "http://100.64.0.9",
    );
  });

  it("https throws when the node has no MagicDNS name yet", async () => {
    await expect(
      serveEndpoint(
        ts({ nodeFqdn: () => Promise.resolve(null) }),
        "https",
        "x",
      ),
    ).rejects.toThrow("has no MagicDNS name yet");
  });

  it("http throws when the node has no tailnet IP yet", async () => {
    await expect(
      serveEndpoint(ts({ nodeIpv4: () => Promise.resolve(null) }), "http", "x"),
    ).rejects.toThrow("has no tailnet IP yet");
  });
});
