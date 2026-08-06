import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { AuditAction } from "@p0rt1on/shared/domain";
import { HostnameHealthChecker } from "./HostnameHealthChecker.ts";
import type { TailnetNode } from "../tailscale/tailscale.ts";

describe("HostnameHealthChecker", () => {
  const ALICE = { friendId: 1, tsHostname: "p0rt1on-alice", serveNodeId: "n1" };

  /** `last` stands in for the friend's audit history, which is the only state
   * the checker has — it holds none of its own. */
  function build(
    nodes: TailnetNode[],
    last?: { action: AuditAction; detail: string | null },
  ) {
    const auditCalls: [number | null, string, string | undefined][] = [];
    let nodesByTagCalls = 0;
    const checker = new HostnameHealthChecker(
      {
        audit: (friendId, action, detail) => {
          auditCalls.push([friendId, action, detail]);
          return Promise.resolve();
        },
        lastHostnameEvent: () => Promise.resolve(last),
      },
      {
        nodesByTag: () => {
          nodesByTagCalls++;
          return Promise.resolve(nodes);
        },
      },
      "tag:p0rt1on-serve",
    );
    return { checker, auditCalls, nodesByTagCallCount: () => nodesByTagCalls };
  }

  it("reports nothing when the live hostname matches the pinned one", async () => {
    const { checker } = build([
      { nodeId: "n1", hostname: "p0rt1on-alice", tags: [], online: true },
    ]);

    expect(await checker.check([ALICE])).toEqual([]);
  });

  it("reports a warning when the live hostname differs", async () => {
    const { checker } = build([
      { nodeId: "n1", hostname: "p0rt1on-alice-1", tags: [], online: true },
    ]);

    const warnings = await checker.check([ALICE]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].friendId).toBe(1);
    expect(warnings[0].warning).toContain("p0rt1on-alice-1");
  });

  it("treats a missing node as a mismatch", async () => {
    const { checker } = build([]);

    expect((await checker.check([ALICE]))[0].warning).toContain(
      "no serve node",
    );
  });

  it("writes an audit row the first time a mismatch is found", async () => {
    const { checker, auditCalls } = build([
      { nodeId: "n1", hostname: "p0rt1on-alice-1", tags: [], online: true },
    ]);

    await checker.check([ALICE]);

    expect(auditCalls.filter((c) => c[1] === "instance_hostname_unclaimed"))
      .toHaveLength(1);
  });

  it("does not re-announce a mismatch the audit trail already records", async () => {
    const nodes: TailnetNode[] = [
      { nodeId: "n1", hostname: "p0rt1on-alice-1", tags: [], online: true },
    ];
    const detail =
      "p0rt1on-alice is currently reachable at p0rt1on-alice-1, not its pinned hostname";
    const { checker, auditCalls } = build(nodes, {
      action: "instance_hostname_unclaimed",
      detail,
    });

    const warnings = await checker.check([ALICE]);

    expect(warnings[0].warning).toBe(detail);
    expect(auditCalls).toHaveLength(0);
  });

  it("writes instance_recovered when a recorded mismatch resolves", async () => {
    const { checker, auditCalls } = build(
      [{ nodeId: "n1", hostname: "p0rt1on-alice", tags: [], online: true }],
      {
        action: "instance_hostname_unclaimed",
        detail: "p0rt1on-alice is currently reachable at p0rt1on-alice-1, " +
          "not its pinned hostname",
      },
    );

    expect(await checker.check([ALICE])).toEqual([]);
    expect(auditCalls.some((c) => c[1] === "instance_recovered")).toBe(true);
  });

  // Accepting repins tsHostname, so the next check matches. That is not a
  // recovery, and claiming the instance "reclaimed" anything would be wrong.
  it("stays silent after an accepted hostname, not claiming a recovery", async () => {
    const { checker, auditCalls } = build(
      [{ nodeId: "n1", hostname: "p0rt1on-alice", tags: [], online: true }],
      { action: "instance_hostname_accepted", detail: "old -> p0rt1on-alice" },
    );

    expect(await checker.check([ALICE])).toEqual([]);
    expect(auditCalls).toHaveLength(0);
  });

  it("fetches the node list once for the whole set", async () => {
    const { checker, nodesByTagCallCount } = build([
      { nodeId: "n1", hostname: "p0rt1on-alice", tags: [], online: true },
      { nodeId: "n2", hostname: "p0rt1on-bob", tags: [], online: true },
    ]);

    await checker.check([
      ALICE,
      { friendId: 2, tsHostname: "p0rt1on-bob", serveNodeId: "n2" },
    ]);

    expect(nodesByTagCallCount()).toBe(1);
  });

  it("makes no Tailscale call when there is nothing to check", async () => {
    const { checker, nodesByTagCallCount } = build([]);

    expect(await checker.check([])).toEqual([]);
    expect(nodesByTagCallCount()).toBe(0);
  });

  it("reports nothing, not a throw, when Tailscale is unreachable with no history", async () => {
    const checker = new HostnameHealthChecker(
      {
        audit: () => Promise.resolve(),
        lastHostnameEvent: () => Promise.resolve(undefined),
      },
      { nodesByTag: () => Promise.reject(new Error("tailscale down")) },
      "tag:p0rt1on-serve",
    );

    expect(await checker.check([ALICE])).toEqual([]);
  });

  // An outage must not read as "healthy" — that would hide a real mismatch.
  it("keeps reporting the recorded warning when Tailscale is unreachable", async () => {
    const detail =
      "p0rt1on-alice is currently reachable at p0rt1on-alice-1, not its pinned hostname";
    const checker = new HostnameHealthChecker(
      {
        audit: () => Promise.resolve(),
        lastHostnameEvent: () =>
          Promise.resolve({
            action: "instance_hostname_unclaimed" as AuditAction,
            detail,
          }),
      },
      { nodesByTag: () => Promise.reject(new Error("tailscale down")) },
      "tag:p0rt1on-serve",
    );

    expect(await checker.check([ALICE])).toEqual([
      { friendId: 1, warning: detail },
    ]);
  });
});
