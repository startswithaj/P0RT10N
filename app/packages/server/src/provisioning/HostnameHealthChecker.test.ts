import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { HostnameHealthChecker } from "./HostnameHealthChecker.ts";
import type { TailnetNode } from "../tailscale/tailscale.ts";

describe("HostnameHealthChecker", () => {
  function build(nodes: TailnetNode[]) {
    const auditCalls: [number | null, string, string | undefined][] = [];
    let nodesByTagCalls = 0;
    const checker = new HostnameHealthChecker(
      {
        audit: (friendId, action, detail) => {
          auditCalls.push([friendId, action, detail]);
          return Promise.resolve();
        },
      },
      {
        nodesByTag: () => {
          nodesByTagCalls++;
          return Promise.resolve(nodes);
        },
      },
      "tag:p0rt1on-serve",
      1000, // warningTtlMs
      100, // nodesTtlMs
    );
    return { checker, auditCalls, nodesByTagCallCount: () => nodesByTagCalls };
  }

  it("returns null when the live hostname matches the pinned one", async () => {
    const { checker } = build([
      { nodeId: "n1", hostname: "p0rt1on-alice", tags: [], online: true },
    ]);

    const warning = await checker.checkHostname(1, "p0rt1on-alice", "n1");

    expect(warning).toBeNull();
  });

  it("returns a warning when the live hostname differs", async () => {
    const { checker } = build([
      { nodeId: "n1", hostname: "p0rt1on-alice-1", tags: [], online: true },
    ]);

    const warning = await checker.checkHostname(1, "p0rt1on-alice", "n1");

    expect(warning).toContain("p0rt1on-alice-1");
  });

  it("writes an audit row the first time a mismatch is found, not on repeats", async () => {
    using time = new FakeTime();
    const { checker, auditCalls } = build([
      { nodeId: "n1", hostname: "p0rt1on-alice-1", tags: [], online: true },
    ]);

    await checker.checkHostname(1, "p0rt1on-alice", "n1");
    time.tick(2000); // past both TTLs
    await checker.checkHostname(1, "p0rt1on-alice", "n1");

    expect(auditCalls.filter((c) => c[1] === "instance_hostname_unclaimed"))
      .toHaveLength(1);
  });

  it("writes instance_recovered when a mismatch resolves", async () => {
    using time = new FakeTime();
    const nodes: TailnetNode[] = [
      { nodeId: "n1", hostname: "p0rt1on-alice-1", tags: [], online: true },
    ];
    const { checker, auditCalls } = build(nodes);

    await checker.checkHostname(1, "p0rt1on-alice", "n1");
    nodes[0].hostname = "p0rt1on-alice";
    time.tick(2000);
    const warning = await checker.checkHostname(1, "p0rt1on-alice", "n1");

    expect(warning).toBeNull();
    expect(auditCalls.some((c) => c[1] === "instance_recovered")).toBe(true);
  });

  it("serves repeat checks within warningTtlMs from cache, no re-fetch", async () => {
    using time = new FakeTime();
    const { checker, nodesByTagCallCount } = build([
      { nodeId: "n1", hostname: "p0rt1on-alice", tags: [], online: true },
    ]);

    await checker.checkHostname(1, "p0rt1on-alice", "n1");
    time.tick(500); // inside warningTtlMs (1000)
    await checker.checkHostname(1, "p0rt1on-alice", "n1");

    expect(nodesByTagCallCount()).toBe(1);
  });

  it("shares one nodesByTag fetch across different instances within nodesTtlMs", async () => {
    const { checker, nodesByTagCallCount } = build([
      { nodeId: "n1", hostname: "p0rt1on-alice", tags: [], online: true },
      { nodeId: "n2", hostname: "p0rt1on-bob", tags: [], online: true },
    ]);

    await checker.checkHostname(1, "p0rt1on-alice", "n1");
    await checker.checkHostname(2, "p0rt1on-bob", "n2");

    expect(nodesByTagCallCount()).toBe(1);
  });

  it("treats a missing node as a mismatch", async () => {
    const { checker } = build([]);

    const warning = await checker.checkHostname(1, "p0rt1on-alice", "n1");

    expect(warning).toContain("no serve node");
  });

  it("returns null, not a throw, when Tailscale is unreachable and there's no prior check", async () => {
    const checker = new HostnameHealthChecker(
      { audit: () => Promise.resolve() },
      { nodesByTag: () => Promise.reject(new Error("tailscale down")) },
      "tag:p0rt1on-serve",
    );

    const warning = await checker.checkHostname(1, "p0rt1on-alice", "n1");

    expect(warning).toBeNull();
  });

  it("falls back to the last known warning when a re-check can't reach Tailscale", async () => {
    using time = new FakeTime();
    const nodes: TailnetNode[] = [
      { nodeId: "n1", hostname: "p0rt1on-alice-1", tags: [], online: true },
    ];
    let reachable = true;

    const fetchNodes = () =>
      reachable
        ? Promise.resolve(nodes)
        : Promise.reject(new Error("tailscale down"));

    const checker = new HostnameHealthChecker(
      { audit: () => Promise.resolve() },
      { nodesByTag: fetchNodes },
      "tag:p0rt1on-serve",
      1000,
      100,
    );

    const first = await checker.checkHostname(1, "p0rt1on-alice", "n1");
    reachable = false;
    time.tick(2000);
    const second = await checker.checkHostname(1, "p0rt1on-alice", "n1");

    expect(second).toBe(first);
  });
});
