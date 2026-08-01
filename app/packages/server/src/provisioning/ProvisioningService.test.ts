import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { OFFBOARD_STEPS, PROVISION_STEPS } from "@p0rt1on/shared/domain";
import type { TailnetNode } from "../tailscale/tailscale.ts";
import type { InstanceSpec } from "../runtime/runtime.ts";
import {
  absentInstance,
  ADD_INPUT,
  buildProvisioningService,
  type Calls,
  CTX,
  DEDICATED_RES,
  TEST_CRED,
} from "../test-helpers/mocks.ts";
import { collect, stepKeys } from "../test-helpers/progressStreams.ts";

describe("ProvisioningService.addFriend", () => {
  it("reserves first, smoke-tests before arming retention, returns a bundle with the auth key", async () => {
    const calls: Calls = [];
    const bundle = await buildProvisioningService(calls, DEDICATED_RES)
      .addFriend(ADD_INPUT);

    expect(calls[0]).toBe("repo:reserveFriend");
    // The ordering-bug guard: smoke-test must precede default retention.
    expect(calls.indexOf("smoke:run")).toBeLessThan(
      calls.indexOf("mc:setDefaultRetention"),
    );
    expect(calls.indexOf("mc:makeBucketWithLock")).toBeLessThan(
      calls.indexOf("smoke:run"),
    );
    expect(calls).toContain("runtime:ensureInstance");
    expect(calls).toContain("mc:setAuditWebhook");
    expect(calls).toContain("repo:activate");
    // The friend key's ID is persisted at mint time so failure-reap and
    // offboard can revoke it; the secret itself stays request-scoped.
    expect(calls).toContain("repo:recordTsKeyId:kid");

    expect(bundle.s3SecretKey).toBe(TEST_CRED.secretKey);
    expect(bundle.tsAuthKey).toBe("tskey-tag:p0rt1on-friend-alice");
    expect(bundle.tailscaleUpCommand).toContain("--authkey=");
    expect(bundle.s3Endpoint).toBe("https://p0rt1on-alice.tailnet.ts.net");
  });

  it("hands the serve key + derived root cred to the runtime in memory", async () => {
    // Secret transport, docker env-file or k8s Secret, is the runtime's
    // business; the service only puts material on the in-memory spec.
    const calls: Calls = [];
    const specs: InstanceSpec[] = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      runtime: {
        ensureInstance: (spec) => {
          specs.push(spec);
          return Promise.resolve({
            name: spec.name,
            id: "id",
            state: "running",
          });
        },
      },
    }).addFriend(ADD_INPUT);

    expect(specs[0].rootCred).toEqual(TEST_CRED);
    expect(specs[0].tsAuthKey).toBe("tskey-tag:p0rt1on-serve");
    // Instance name = tailnet hostname (dedicated: `p0rt1on-<friend>`).
    expect(specs[0].name).toBe("p0rt1on-alice");
  });

  it("records the serve node's ID at provision (for id-based offboard)", async () => {
    const calls: Calls = [];
    // The serve node is freshly enrolled, so its hostname is still unambiguous.
    const nodes: TailnetNode[] = [
      { nodeId: "srv1", hostname: "p0rt1on-alice", tags: [], online: true },
    ];
    await buildProvisioningService(calls, DEDICATED_RES, { nodes })
      .addFriend(ADD_INPUT);

    expect(calls).toContain("repo:recordServeNodeId:srv1");
  });

  it("auto ACL mode edits the tailnet policy; no manual instructions", async () => {
    const calls: Calls = [];
    const bundle = await buildProvisioningService(calls, DEDICATED_RES)
      .addFriend(ADD_INPUT);

    expect(calls).toContain("ts:ensureFriendAcl");
    expect(bundle.manualAclInstructions).toBeUndefined();
  });

  it("manual ACL mode skips the policy edit and returns paste-in instructions", async () => {
    const calls: Calls = [];
    const bundle = await buildProvisioningService(calls, DEDICATED_RES, {
      config: { aclMode: "manual" },
    }).addFriend(ADD_INPUT);

    expect(calls).not.toContain("ts:ensureFriendAcl");
    expect(bundle.manualAclInstructions).toContain(
      "tag:p0rt1on-friend-alice",
    );
    expect(bundle.manualAclInstructions).toContain("100.64.0.1"); // instance IP
    expect(bundle.manualAclInstructions).toContain("tcp:443");
  });

  it("http serve mode: endpoint scheme + ACL grant port follow the mode", async () => {
    const calls: Calls = [];
    const bundle = await buildProvisioningService(calls, DEDICATED_RES, {
      // Manual mode surfaces the grant endpoint so we can assert the port.
      config: { serveMode: "http", aclMode: "manual" },
    }).addFriend(ADD_INPUT);

    // Friend endpoint is http, and http mode addresses the node by its tailnet
    // IP (no MagicDNS-bound cert), not the MagicDNS FQDN.
    expect(bundle.s3Endpoint).toBe("http://100.64.0.1");
    expect(bundle.manualAclInstructions).toContain("tcp:80");
    expect(bundle.manualAclInstructions).not.toContain("tcp:443");
  });

  it("throws when the serve node has no MagicDNS name yet (no domain fallback)", async () => {
    const calls: Calls = [];
    await expect(
      buildProvisioningService(calls, DEDICATED_RES, {
        tailscale: { nodeFqdn: () => Promise.resolve(null) },
      }).addFriend(ADD_INPUT),
    ).rejects.toThrow("has no MagicDNS name yet");
  });

  it("adopting the existing shared pool verifies it instead of assuming", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, {
      ...DEDICATED_RES,
      instanceExisted: true,
    }).addFriend({ ...ADD_INPUT, isolationMode: "shared" });

    // No new container is created, but the adopted one is started if stopped
    // and health-verified before any bucket work touches it.
    expect(calls).not.toContain("runtime:ensureInstance");
    expect(calls).toContain("runtime:ensureRunning:p0rt1on-alice");
    expect(calls.indexOf("runtime:waitUntilHealthy")).toBeLessThan(
      calls.indexOf("mc:makeBucketWithLock"),
    );
  });

  it("adopting an unhealthy pool fails the add cleanly (no silent adopt)", async () => {
    const calls: Calls = [];
    const svc = buildProvisioningService(calls, {
      ...DEDICATED_RES,
      instanceExisted: true,
    }, {
      runtime: {
        waitUntilHealthy: () =>
          Promise.reject(new Error("did not become healthy")),
      },
    });

    await expect(svc.addFriend({ ...ADD_INPUT, isolationMode: "shared" }))
      .rejects.toThrow("did not become healthy");
    expect(calls).toContain("repo:markFailed");
    expect(calls).not.toContain("mc:makeBucketWithLock");
  });

  it("marks the friend failed and rethrows when a step throws", async () => {
    const calls: Calls = [];
    const svc = buildProvisioningService(calls, DEDICATED_RES, {
      smoke: () => Promise.reject(new Error("smoke failed")),
    });

    await expect(svc.addFriend(ADD_INPUT)).rejects.toThrow("smoke failed");
    expect(calls).toContain("repo:markFailed");
    // The failed add is audited (it runs detached, so no tRPC middleware sees it).
    expect(calls).toContain("repo:audit:action_failed");
    // Retention must NOT be armed after a failed smoke-test.
    expect(calls).not.toContain("mc:setDefaultRetention");
  });
});

describe("ProvisioningService.rotateKey", () => {
  it("replaces the user and returns a bundle WITHOUT a tailscale key", async () => {
    const calls: Calls = [];
    const bundle = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
    }).rotateKey(1);

    expect(calls).toContain("mc:removeUser");
    expect(calls).toContain("mc:createUser");
    expect(calls).toContain("mc:attachPolicy");
    expect(bundle.s3SecretKey).toBe(TEST_CRED.secretKey);
    expect(bundle.tsAuthKey).toBeUndefined();
    expect(bundle.tailscaleUpCommand).toBeUndefined();
  });
});

describe("ProvisioningService.rotateKey (gap-free)", () => {
  it("creates and records the new credential BEFORE removing the old", async () => {
    // Regression: remove-then-create left the friend credential-less when
    // createUser failed. The order must be create, attach, persist, then remove.
    const calls: Calls = [];
    const bundle = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
    }).rotateKey(1);

    expect(calls.indexOf("mc:createUser")).toBeLessThan(
      calls.indexOf("mc:removeUser"),
    );
    expect(calls.indexOf("repo:recordAccessKey")).toBeLessThan(
      calls.indexOf("mc:removeUser"),
    );
    expect(bundle.warnings).toBeUndefined();
  });

  it("createUser failure leaves the old credential and DB untouched", async () => {
    const calls: Calls = [];
    const svc = buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
      mc: { createUser: () => Promise.reject(new Error("minio down")) },
    });

    await expect(svc.rotateKey(1)).rejects.toThrow("minio down");
    expect(calls).not.toContain("repo:recordAccessKey");
    expect(calls).not.toContain("mc:removeUser");
  });

  it("old-credential removal failure succeeds WITH a warning in the bundle", async () => {
    const calls: Calls = [];
    const bundle = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
      mc: { removeUser: () => Promise.reject(new Error("flaky")) },
    }).rotateKey(1);

    expect(calls).toContain("repo:recordAccessKey");
    expect(bundle.s3SecretKey).toBe(TEST_CRED.secretKey);
    expect(bundle.warnings?.join(" ")).toContain("could not be removed");
  });

  it("sweeps stale policy-attached users first and reports it", async () => {
    // A stale user from a previously failed rotation, which MinIO knows but the
    // DB doesn't, is removed; the recorded and unrelated users are kept.
    const calls: Calls = [];
    const removed: string[] = [];
    const bundle = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
      mc: {
        listUsers: () =>
          Promise.resolve([
            { accessKeyId: "AKIASTALE", policies: ["alice"] },
            { accessKeyId: "AKIAOLD", policies: ["alice"] },
            { accessKeyId: "AKIAUNRELATED", policies: ["other"] },
          ]),
        removeUser: (id) => {
          removed.push(id);
          return Promise.resolve();
        },
      },
    }).rotateKey(1);

    expect(removed).toEqual(["AKIASTALE", "AKIAOLD"]);
    expect(bundle.warnings?.join(" ")).toContain("stale credential");
  });
});

describe("ProvisioningService.reissueTsKey", () => {
  it("mints a fresh auth key for the friend's node tag", async () => {
    const calls: Calls = [];
    const b = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
    }).reissueTsKey(1);

    expect(b.name).toBe("alice");
    expect(b.tsAuthKey).toBe("tskey-tag:p0rt1on-friend-alice");
    expect(b.tailscaleUpCommand).toContain("--authkey=");
    expect(calls).toContain("ts:mintAuthKey:tag:p0rt1on-friend-alice");
  });

  it("records the new key ID, then revokes the superseded key", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
    }).reissueTsKey(1);

    // Mint-then-revoke: the friend is never left keyless if the mint fails.
    expect(calls.indexOf("ts:mintAuthKey:tag:p0rt1on-friend-alice"))
      .toBeLessThan(calls.indexOf("ts:revokeAuthKey:kid-old"));
    expect(calls).toContain("repo:recordTsKeyId:kid");
  });

  it("skips revocation when no key ID is stored (pre-column friend)", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve({ ...CTX, tsKeyId: null }) },
    }).reissueTsKey(1);

    expect(calls.some((c) => c.startsWith("ts:revokeAuthKey"))).toBe(false);
  });
});

describe("ProvisioningService.offboard", () => {
  it("dedicated: tears down resources and reaps the instance", async () => {
    const calls: Calls = [];
    const nodes: TailnetNode[] = [
      { nodeId: "n1", hostname: "alice", tags: [], online: true },
    ];
    await buildProvisioningService(calls, DEDICATED_RES, {
      nodes,
      repo: { context: () => Promise.resolve(CTX) },
    }).offboard(1);

    expect(calls).toContain("mc:removeBucket");
    // The bucket-scoped IAM policy must not outlive the friend.
    expect(calls).toContain("mc:removePolicy");
    expect(calls).toContain("ts:deleteNode:n1");
    // Neither may the enrollment key survive: unused, it stays live ~90 days.
    expect(calls).toContain("ts:revokeAuthKey:kid-old");
    expect(calls).toContain("runtime:removeInstance");
    expect(calls).toContain("repo:deleteInstance");
  });

  it("removes stale policy-attached users during teardown", async () => {
    // No credential may outlive the friend, including ones a failed rotation
    // left behind that only MinIO knows about.
    const calls: Calls = [];
    const removed: string[] = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
      mc: {
        listUsers: () =>
          Promise.resolve([{ accessKeyId: "AKIASTALE", policies: ["alice"] }]),
        removeUser: (id) => {
          removed.push(id);
          return Promise.resolve();
        },
      },
    }).offboard(1);

    expect(removed).toEqual(["AKIAOLD", "AKIASTALE"]);
  });

  it("a retried offboard completes after a partial first attempt", async () => {
    // Idempotency: every destructive step tolerates "already absent", so the
    // retry runs cleanly from the top.
    const calls: Calls = [];
    let bucketGone = false;
    const svc = buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
      mc: {
        removeBucket: () => {
          if (!bucketGone) {
            bucketGone = true;
            return Promise.reject(new Error("minio down"));
          }
          return Promise.resolve();
        },
      },
    });

    await expect(svc.offboard(1)).rejects.toThrow("minio down");
    expect(calls).not.toContain("repo:deleteFriend");
    await svc.offboard(1);
    expect(calls).toContain("repo:deleteFriend");
  });

  it("skips MinIO teardown when the instance is already gone", async () => {
    // If the container was removed out-of-band, reaching in with mc would hang
    // on a refused connection, so storage must be treated as already torn down.
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
      runtime: { diagnoseInstance: absentInstance },
    }).offboard(1);

    expect(calls).not.toContain("mc:removeUser");
    expect(calls).not.toContain("mc:removePolicy");
    expect(calls).not.toContain("mc:removeBucket");
    expect(calls).toContain("ts:revokeAuthKey:kid-old");
    expect(calls).toContain("repo:deleteFriend");
    expect(calls).toContain("runtime:removeInstance");
  });

  it("refuses a COMPLIANCE friend with data BEFORE any destructive step", async () => {
    // COMPLIANCE-locked objects are undeletable until retention lapses, so
    // failing up front beats failing opaquely after the user and policy are gone.
    const calls: Calls = [];
    const svc = buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        context: () =>
          Promise.resolve({ ...CTX, lockMode: "COMPLIANCE" as const }),
      },
      mc: { du: () => Promise.resolve({ bytesUsed: 10, objectCount: 3 }) },
    });

    await expect(svc.offboard(1)).rejects.toThrow(/COMPLIANCE retention/);
    expect(calls).not.toContain("mc:removeUser");
    expect(calls).not.toContain("mc:removeBucket");
    expect(calls).not.toContain("repo:deleteFriend");
  });

  it("offboards an EMPTY COMPLIANCE bucket normally (no locks exist)", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        context: () =>
          Promise.resolve({ ...CTX, lockMode: "COMPLIANCE" as const }),
      },
    }).offboard(1); // mock du reports zero objects

    expect(calls).toContain("repo:deleteFriend");
  });

  it("manual ACL mode: never calls the policy API, returns cleanup advice", async () => {
    // The token cannot edit the policy in manual mode, so a 403 mid-teardown
    // would strand the friend row after the user and bucket are already gone.
    const calls: Calls = [];
    const result = await buildProvisioningService(calls, DEDICATED_RES, {
      config: { aclMode: "manual" },
      repo: { context: () => Promise.resolve(CTX) },
    }).offboard(1);

    expect(calls).not.toContain("ts:removeFriendAcl");
    expect(calls).toContain("repo:deleteFriend");
    expect(result.manualAclCleanup).toContain("tag:p0rt1on-friend-alice");
    expect(result.manualAclCleanup).toContain("Remove");
  });

  it("auto ACL mode: calls the policy API and returns no advice", async () => {
    const calls: Calls = [];
    const result = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
    }).offboard(1);

    expect(calls).toContain("ts:removeFriendAcl");
    expect(result.manualAclCleanup).toBeUndefined();
  });

  it("records the offboard audit BEFORE deleting the friend row", async () => {
    // Regression: the audit FK references friends.id, so auditing after the
    // delete tripped a foreign key constraint; order must be audit, then delete.
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
    }).offboard(1);

    expect(calls).toContain("repo:audit:offboard");
    expect(calls.indexOf("repo:audit:offboard")).toBeLessThan(
      calls.indexOf("repo:deleteFriend"),
    );
  });

  it("shared: with friends remaining, does NOT reap the instance", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        context: () => Promise.resolve({ ...CTX, isolationMode: "shared" }),
        // The atomic count-and-mark says friends remain, so nothing was marked.
        markInstanceReaping: () => Promise.resolve(false),
      },
    }).offboard(1);

    expect(calls).toContain("repo:deleteFriend");
    expect(calls).not.toContain("runtime:removeInstance");
    expect(calls).not.toContain("repo:deleteInstance");
  });
});

describe("ProvisioningService.sweepFailed", () => {
  it("reaps failed friends: best-effort teardown + delete rows", async () => {
    const calls: Calls = [];
    const nodes: TailnetNode[] = [
      { nodeId: "n1", hostname: "alice", tags: [], online: true },
    ];
    const n = await buildProvisioningService(calls, DEDICATED_RES, {
      nodes,
      repo: {
        failedFriendIds: () => Promise.resolve([1]),
        context: () => Promise.resolve(CTX),
      },
    }).sweepFailed();

    expect(n).toBe(1);
    expect(calls).toContain("mc:removeBucket");
    expect(calls).toContain("ts:revokeAuthKey:kid-old");
    expect(calls).toContain("repo:deleteFriend");
    expect(calls).toContain("runtime:removeInstance");
    expect(calls).toContain("repo:deleteInstance");
  });

  it("reaps a failed friend whose instance is already gone", async () => {
    // An absent instance means storage steps are vacuously done, so the sweep
    // clears the tombstone instead of retrying a refused connection forever.
    const calls: Calls = [];
    const n = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        failedFriendIds: () => Promise.resolve([1]),
        context: () => Promise.resolve(CTX),
      },
      runtime: { diagnoseInstance: absentInstance },
    }).sweepFailed();

    expect(n).toBe(1);
    expect(calls).not.toContain("mc:removeBucket");
    expect(calls).toContain("repo:deleteFriend");
    expect(calls).toContain("repo:deleteInstance");
  });

  it("keeps the tombstone when key revocation fails", async () => {
    // The stored key ID is the only record a live enrollment key exists, so
    // it is gated the same as every other resource step.
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        failedFriendIds: () => Promise.resolve([1]),
        context: () => Promise.resolve(CTX),
      },
      tailscale: {
        revokeAuthKey: () => Promise.reject(new Error("api down")),
      },
    }).sweepFailed();

    expect(calls).not.toContain("repo:deleteFriend");
  });

  it("reaps orphaned failed instances (no friend rows left)", async () => {
    const calls: Calls = [];
    const n = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        failedFriendIds: () => Promise.resolve([]),
        failedInstances: () =>
          Promise.resolve([{
            instanceId: 10,
            tsHostname: "ghost",
            serveNodeId: null,
          }]),
      },
    }).sweepFailed();

    expect(n).toBe(1);
    expect(calls).toContain("runtime:removeInstance");
    expect(calls).toContain("repo:deleteInstance");
  });

  it("orphan reap deletes the serve node by STORED ID despite a rename", async () => {
    // A stale node made the control plane rename this one to <host>-1, so a
    // hostname match would miss it, but the stored ID still finds it.
    const calls: Calls = [];
    const nodes: TailnetNode[] = [
      { nodeId: "srv1", hostname: "p0rt1on-alice-1", tags: [], online: false },
    ];
    await buildProvisioningService(calls, DEDICATED_RES, {
      nodes,
      repo: {
        failedFriendIds: () => Promise.resolve([]),
        failedInstances: () =>
          Promise.resolve([{
            instanceId: 10,
            tsHostname: "p0rt1on-alice",
            serveNodeId: "srv1",
          }]),
      },
    }).sweepFailed();

    expect(calls).toContain("ts:deleteNode:srv1");
  });

  it("orphan reap without a stored ID falls back to hostname (misses a rename)", async () => {
    // Pre-column behavior: a null ID falls back to a hostname match, which a
    // rename defeats; this documents exactly why the ID column exists.
    const calls: Calls = [];
    const nodes: TailnetNode[] = [
      { nodeId: "srv1", hostname: "p0rt1on-alice-1", tags: [], online: false },
    ];
    await buildProvisioningService(calls, DEDICATED_RES, {
      nodes,
      repo: {
        failedFriendIds: () => Promise.resolve([]),
        failedInstances: () =>
          Promise.resolve([{
            instanceId: 10,
            tsHostname: "p0rt1on-alice",
            serveNodeId: null,
          }]),
      },
    }).sweepFailed();

    expect(calls).not.toContain("ts:deleteNode:srv1");
  });

  it("best-effort: swallows a teardown error and still deletes the friend", async () => {
    const calls: Calls = [];
    const svc = buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        failedFriendIds: () => Promise.resolve([1]),
        // No s3AccessKeyId, since it failed before the user was created, so
        // removeUser is skipped.
        context: () => Promise.resolve({ ...CTX, s3AccessKeyId: null }),
        // deleteInstance rejects mid-reap, so attempt() must swallow it.
        deleteInstance: () => Promise.reject(new Error("db down")),
      },
    });
    const n = await svc.sweepFailed();
    expect(n).toBe(1);
    expect(calls).toContain("repo:deleteFriend");
  });

  it("keeps the tombstone when a resource step fails (no deleteFriend)", async () => {
    // Regression: reap during a MinIO outage must not delete the friend row,
    // since the row is the only record that the bucket and user exist.
    const calls: Calls = [];
    const n = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        failedFriendIds: () => Promise.resolve([1]),
        context: () => Promise.resolve(CTX),
      },
      mc: { removeBucket: () => Promise.reject(new Error("minio down")) },
    }).sweepFailed();

    expect(n).toBe(1);
    expect(calls).not.toContain("repo:deleteFriend");
    expect(calls).not.toContain("runtime:removeInstance");
    expect(calls).not.toContain("repo:deleteInstance");
  });

  it("converges on the next sweep once teardown succeeds again", async () => {
    const calls: Calls = [];
    let minioDown = true;
    const svc = buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        failedFriendIds: () => Promise.resolve([1]),
        context: () => Promise.resolve(CTX),
      },
      mc: {
        removeBucket: () =>
          minioDown
            ? Promise.reject(new Error("minio down"))
            : Promise.resolve(),
      },
    });

    await svc.sweepFailed();
    expect(calls).not.toContain("repo:deleteFriend");
    minioDown = false;
    await svc.sweepFailed();
    expect(calls).toContain("repo:deleteFriend");
    expect(calls).toContain("repo:deleteInstance");
  });

  it("keeps an orphan instance row when the container removal fails", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        failedInstances: () =>
          Promise.resolve([{
            instanceId: 10,
            tsHostname: "ghost",
            serveNodeId: null,
          }]),
      },
      runtime: {
        removeInstance: () => Promise.reject(new Error("docker down")),
      },
    }).sweepFailed();

    expect(calls).not.toContain("repo:deleteInstance");
  });

  it("skips reaping a COMPLIANCE friend with data; tombstone kept", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        failedFriendIds: () => Promise.resolve([1]),
        context: () =>
          Promise.resolve({ ...CTX, lockMode: "COMPLIANCE" as const }),
      },
      mc: { du: () => Promise.resolve({ bytesUsed: 10, objectCount: 3 }) },
    }).sweepFailed();

    expect(calls).not.toContain("mc:removeBucket");
    expect(calls).not.toContain("repo:deleteFriend");
  });

  it("returns 0 when there are no tombstones", async () => {
    const n = await buildProvisioningService([], DEDICATED_RES).sweepFailed();
    expect(n).toBe(0);
  });
});

describe("ProvisioningService.addFriendStream", () => {
  it("emits every provisioning step in order, then a done event with the bundle", async () => {
    const { events, error } = await collect(
      buildProvisioningService([], DEDICATED_RES).addFriendStream(ADD_INPUT),
    );

    expect(error).toBeNull();
    expect(stepKeys(events)).toEqual(PROVISION_STEPS.map((s) => s.key));
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.result.s3SecretKey).toBe(TEST_CRED.secretKey);
    }
  });

  it("stops at the failing step (does not march past it) and errors", async () => {
    const calls: Calls = [];
    const { events, error } = await collect(
      buildProvisioningService(calls, DEDICATED_RES, {
        smoke: () => Promise.reject(new Error("smoke failed")),
      }).addFriendStream(ADD_INPUT),
    );

    expect(stepKeys(events)).toEqual([
      "instance",
      "tailnet",
      "authkey",
      "bucket",
      "smoke",
    ]);
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(String(error)).toContain("smoke failed");
    // The failing friend is still marked for the cleanup sweep.
    expect(calls).toContain("repo:markFailed");
  });
});

describe("ProvisioningService.offboardStream", () => {
  it("emits every teardown step in order, then a done event", async () => {
    const { events, error } = await collect(
      buildProvisioningService([], DEDICATED_RES, {
        repo: { context: () => Promise.resolve(CTX) },
      }).offboardStream(1),
    );

    expect(error).toBeNull();
    expect(stepKeys(events)).toEqual(OFFBOARD_STEPS.map((s) => s.key));
    expect(events.at(-1)?.type).toBe("done");
  });
});
