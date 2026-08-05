import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { TailnetNode } from "../tailscale/tailscale.ts";
import {
  buildProvisioningService,
  type Calls,
  CTX,
  DEDICATED_RES,
} from "../test-helpers/mocks.ts";

describe("ProvisioningService.acceptHostname", () => {
  it("pins tsHostname to the serve node's current hostname and records it", async () => {
    const calls: Calls = [];
    const nodes: TailnetNode[] = [
      { nodeId: "n1", hostname: "alice-live", tags: [], online: true },
    ];
    await buildProvisioningService(calls, DEDICATED_RES, {
      nodes,
      repo: { context: () => Promise.resolve({ ...CTX, serveNodeId: "n1" }) },
    }).acceptHostname(1);

    expect(calls).toContain("repo:recordConfirmedHostname:alice-live");
    expect(calls).toContain("repo:audit:instance_hostname_accepted");
  });

  it("throws when the recorded serve node is gone", async () => {
    const calls: Calls = [];
    await expect(
      buildProvisioningService(calls, DEDICATED_RES, {
        nodes: [],
        repo: {
          context: () => Promise.resolve({ ...CTX, serveNodeId: "n1" }),
        },
      }).acceptHostname(1),
    ).rejects.toThrow("has no serve node to accept");
  });
});

describe("ProvisioningService.retryHostnameClaim", () => {
  it("restarts the instance and confirms the reclaim once the name is free", async () => {
    const calls: Calls = [];
    // Before restart: the instance sits on a mismatched name, nothing holds
    // the pinned one — free to reclaim. After restart: it comes back
    // registered under the pinned name, confirming success.
    let restarted = false;

    const nodesByTag = () =>
      Promise.resolve(
        restarted
          ? [{ nodeId: "n1", hostname: "alice", tags: [], online: true }]
          : [{ nodeId: "old", hostname: "alice-1", tags: [], online: true }],
      );

    const result = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
      tailscale: { nodesByTag },
      runtime: {
        ensureRunning: (name) => {
          restarted = true;
          calls.push(`runtime:ensureRunning:${name}`);
          return Promise.resolve();
        },
      },
    }).retryHostnameClaim(1);

    expect(calls).toContain("runtime:stopInstance:alice");
    expect(calls.indexOf("runtime:stopInstance:alice")).toBeLessThan(
      calls.indexOf("runtime:ensureRunning:alice"),
    );
    expect(calls).toContain("runtime:waitUntilHealthy");
    expect(result).toEqual({ reclaimed: true, hostname: "alice" });
  });

  it("refuses to restart when the pinned name is still held by an online device", async () => {
    const calls: Calls = [];
    const nodes: TailnetNode[] = [
      { nodeId: "other", hostname: "alice", tags: [], online: true },
    ];

    const result = await buildProvisioningService(calls, DEDICATED_RES, {
      nodes,
      repo: { context: () => Promise.resolve(CTX) },
    }).retryHostnameClaim(1);

    expect(calls.some((c) => c.startsWith("runtime:stopInstance"))).toBe(
      false,
    );
    expect(result).toEqual({ reclaimed: false, hostname: "alice" });
  });

  it("reports not reclaimed when the restart lands on a different name again", async () => {
    const calls: Calls = [];
    const nodes: TailnetNode[] = [
      { nodeId: "n1", hostname: "alice-2", tags: [], online: true },
    ];

    const result = await buildProvisioningService(calls, DEDICATED_RES, {
      nodes,
      repo: { context: () => Promise.resolve(CTX) },
    }).retryHostnameClaim(1);

    expect(calls).toContain("runtime:stopInstance:alice");
    expect(result).toEqual({ reclaimed: false, hostname: "alice-2" });
  });
});
