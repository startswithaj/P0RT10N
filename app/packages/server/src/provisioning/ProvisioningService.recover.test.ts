import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { TailnetNode } from "../tailscale/tailscale.ts";
import {
  buildProvisioningService,
  type Calls,
  DEDICATED_RES,
} from "../test-helpers/mocks.ts";

describe("ProvisioningService boot recovery", () => {
  const instance = {
    instanceId: 1,
    tsHostname: "p0rt1on-alice",
    minioPort: 9100,
  };

  // A serve node still holding the hostname on the tailnet (the DR case).
  const staleNode = (): TailnetNode[] => [
    { nodeId: "old", hostname: "p0rt1on-alice", tags: [], online: true },
  ];

  const oneFriend = {
    liveFriendTagsOnInstance: () =>
      Promise.resolve(["tag:p0rt1on-friend-alice"]),
  };

  it("recover frees the hostname, recreates over data, records node, realigns", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      nodes: staleNode(),
      repo: oneFriend,
    }).recoverInstance(instance);

    // Stale serve node deleted BEFORE the recreate, so the hostname is free.
    expect(calls.indexOf("ts:deleteNode:old")).toBeLessThan(
      calls.indexOf("runtime:ensureInstance"),
    );
    // Recreate over existing data, then wait healthy.
    expect(calls.indexOf("runtime:ensureInstance")).toBeLessThan(
      calls.indexOf("runtime:waitUntilHealthy"),
    );
    // Mints a fresh SERVE key (server-side tag), not a friend key.
    expect(calls).toContain("ts:mintAuthKey:tag:p0rt1on-serve");
    // Never re-creates the bucket; that data survives in the pantry.
    expect(calls).not.toContain("mc:makeBucketWithLock");
    expect(calls).toContain("repo:recordServeNodeId:old");
    expect(calls).toContain("mc:setAuditWebhook");
    expect(calls).toContain("ts:ensureFriendAcl");
    // Recorded in the audit trail so the recovery is visible after the fact.
    expect(calls).toContain("repo:audit:instance_recovered");
  });

  it("recover re-applies an ACL grant for EACH live friend (shared pool)", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      nodes: staleNode(),
      repo: {
        liveFriendTagsOnInstance: () =>
          Promise.resolve([
            "tag:p0rt1on-friend-bob",
            "tag:p0rt1on-friend-carol",
          ]),
      },
    }).recoverInstance(instance);

    expect(calls.filter((c) => c === "ts:ensureFriendAcl")).toHaveLength(2);
  });

  it("recover in manual ACL mode recreates but never touches the policy", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      config: { aclMode: "manual" },
      nodes: staleNode(),
      repo: oneFriend,
    }).recoverInstance(instance);

    expect(calls).toContain("runtime:ensureInstance");
    expect(calls).not.toContain("ts:ensureFriendAcl");
  });

  it("realign re-issues the webhook + ACLs without recreating or re-keying", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      nodes: staleNode(),
      repo: oneFriend,
    }).realignInstance(instance);

    expect(calls).toContain("mc:setAuditWebhook");
    expect(calls).toContain("ts:ensureFriendAcl");
    expect(calls).not.toContain("runtime:ensureInstance");
    expect(calls).not.toContain("ts:mintAuthKey:tag:p0rt1on-serve");
    expect(calls.some((c) => c.startsWith("ts:deleteNode"))).toBe(false);
  });
});
