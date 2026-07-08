import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { OFFBOARD_STEPS, PROVISION_STEPS } from "@p0rt1on/shared/domain";
import type { TailnetNode } from "../tailscale/tailscale.ts";
import {
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

    expect(bundle.s3SecretKey).toBe(TEST_CRED.secretKey);
    expect(bundle.tsAuthKey).toBe("tskey-tag:p0rt1on-friend-alice");
    expect(bundle.tailscaleUpCommand).toContain("--authkey=");
    expect(bundle.s3Endpoint).toBe("https://p0rt1on-alice.tailnet.ts.net");
  });

  it("delivers TAILSCALE_AUTHKEY via the env-file alongside the root creds", async () => {
    const calls: Calls = [];
    const written: string[] = [];
    await buildProvisioningService(calls, DEDICATED_RES, { written })
      .addFriend(ADD_INPUT);

    const envFile = written.find((w) => w.includes("MINIO_ROOT_USER="));
    expect(envFile).toContain("MINIO_ROOT_PASSWORD=");
    // The serve key rides the env-file, never the docker argv.
    expect(envFile).toContain("TAILSCALE_AUTHKEY=tskey-tag:p0rt1on-serve");
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

  it("adopting the existing shared pool verifies it instead of assuming", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, {
      ...DEDICATED_RES,
      instanceExisted: true,
    }).addFriend({ ...ADD_INPUT, isolationMode: "shared" });

    // No new container — but the adopted one is started (if stopped) and
    // health-verified before any bucket work touches it.
    expect(calls).not.toContain("runtime:ensureInstance");
    expect(calls).toContain("runtime:ensureRunning");
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
    expect(calls).toContain("runtime:removeInstance");
    expect(calls).toContain("repo:deleteInstance");
  });

  it("records the offboard audit BEFORE deleting the friend row", async () => {
    // Regression: the audit FK references friends.id, so auditing after the
    // delete tripped a FOREIGN KEY constraint. Order must be audit → delete.
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: { context: () => Promise.resolve(CTX) },
    }).offboard(1);

    expect(calls).toContain("repo:audit");
    expect(calls.indexOf("repo:audit")).toBeLessThan(
      calls.indexOf("repo:deleteFriend"),
    );
  });

  it("shared: with friends remaining, does NOT reap the instance", async () => {
    const calls: Calls = [];
    await buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        context: () => Promise.resolve({ ...CTX, isolationMode: "shared" }),
        friendsOnInstance: () => Promise.resolve(2),
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
    expect(calls).toContain("repo:deleteFriend");
    expect(calls).toContain("runtime:removeInstance");
    expect(calls).toContain("repo:deleteInstance");
  });

  it("reaps orphaned failed instances (no friend rows left)", async () => {
    const calls: Calls = [];
    const n = await buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        failedFriendIds: () => Promise.resolve([]),
        failedInstances: () =>
          Promise.resolve([{ instanceId: 10, tsHostname: "ghost" }]),
      },
    }).sweepFailed();

    expect(n).toBe(1);
    expect(calls).toContain("runtime:removeInstance");
    expect(calls).toContain("repo:deleteInstance");
  });

  it("best-effort: swallows a teardown error and still deletes the friend", async () => {
    const calls: Calls = [];
    const svc = buildProvisioningService(calls, DEDICATED_RES, {
      repo: {
        failedFriendIds: () => Promise.resolve([1]),
        // No s3AccessKeyId (failed before the user was created) → skip removeUser.
        context: () => Promise.resolve({ ...CTX, s3AccessKeyId: null }),
        // deleteInstance rejects mid-reap → attempt() must swallow it.
        deleteInstance: () => Promise.reject(new Error("db down")),
      },
    });
    // deleteInstance rejects inside reapInstance → attempt() swallows it.
    const n = await svc.sweepFailed();
    expect(n).toBe(1);
    expect(calls).toContain("repo:deleteFriend");
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
    // Real per-step progress — one step event per PROVISION_STEPS entry, in order.
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

    // The stream halts exactly at "smoke": earlier steps emitted, later ones not.
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
