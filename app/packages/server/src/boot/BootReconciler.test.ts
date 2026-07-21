import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { ContainerState } from "../runtime/runtime.ts";
import type { ProvisioningRepo } from "../provisioning/deps.ts";
import {
  type Calls,
  DEDICATED_RES,
  mockInstanceRuntime,
  mockProvisioningRepo,
  noopLogger,
} from "../test-helpers/mocks.ts";
import { BootReconciler, type InstanceReconcileOps } from "./BootReconciler.ts";

describe("BootReconciler", () => {
  const ROW = {
    instanceId: 10,
    tsHostname: "alice",
    minioPort: 9100,
    status: "active",
  };
  const running = { name: "alice", state: "running" as ContainerState };
  const stopped = { name: "alice", state: "stopped" as ContainerState };

  function build(
    calls: Calls,
    opts: {
      rows?: typeof ROW[];
      instances?: { name: string; state: ContainerState }[];
      healthFor?: (name: string) => "healthy" | "unhealthy";
      hasDataFor?: (name: string) => boolean;
      listError?: Error;
      repo?: Partial<ProvisioningRepo>;
    } = {},
  ) {
    // ProvisioningService supplies these in production; here they just record.
    const ops: InstanceReconcileOps = {
      realignInstance: (i) => {
        calls.push(`ops:realign:${i.tsHostname}`);
        return Promise.resolve();
      },
      recoverInstance: (i) => {
        calls.push(`ops:recover:${i.tsHostname}`);
        return Promise.resolve();
      },
    };
    return new BootReconciler(
      mockProvisioningRepo(calls, DEDICATED_RES, {
        liveInstances: () => Promise.resolve(opts.rows ?? [ROW]),
        ...opts.repo,
      }),
      mockInstanceRuntime(calls, opts),
      ops,
      noopLogger(),
      { attempts: 2, delayMs: 0 }, // bounded wait, no real sleeping in tests
    );
  }

  it("running + healthy: realigns (webhook + ACLs), touches nothing else", async () => {
    const calls: Calls = [];
    const summary = await build(calls, { instances: [running] }).run();

    expect(summary).toEqual({
      started: 0,
      healthy: 1,
      recovered: 0,
      failed: 0,
      orphaned: 0,
      degraded: 0,
    });
    expect(calls).toContain("ops:realign:alice");
    // Adopt runs even when healthy — it converges config drift (restart
    // policy); the actual no-start behaviour is DockerRuntime's, tested there.
    expect(calls).toContain(`runtime:ensureRunning:alice`);
  });

  it("stopped: starts it, verifies health, then realigns", async () => {
    const calls: Calls = [];
    const summary = await build(calls, { instances: [stopped] }).run();

    expect(summary.started).toBe(1);
    expect(calls.indexOf(`runtime:ensureRunning:alice`)).toBeLessThan(
      calls.indexOf("ops:realign:alice"),
    );
  });

  it("absent container but data survives: recreates over it, never fails", async () => {
    const calls: Calls = [];
    const summary = await build(calls, { instances: [] }).run();

    expect(summary.recovered).toBe(1);
    expect(calls).toContain("ops:recover:alice");
    // Data survives ⇒ never marked failed, never realigned separately.
    expect(calls.some((c) => c.startsWith("repo:failInstanceMissing")))
      .toBe(false);
  });

  it("absent container AND data gone: marks failed, never recreates", async () => {
    const calls: Calls = [];
    const summary = await build(calls, {
      instances: [],
      hasDataFor: () => false,
    }).run();

    expect(summary.failed).toBe(1);
    expect(calls).toContain("repo:failInstanceMissing:10");
    // No empty instance fabricated over the lost backups.
    expect(calls).not.toContain("ops:recover:alice");
  });

  it("unhealthy after the bounded wait: logged as degraded, NOTHING deleted or marked", async () => {
    const calls: Calls = [];
    const summary = await build(calls, {
      instances: [running],
      healthFor: () => "unhealthy",
    }).run();

    expect(summary.degraded).toBe(1);
    // Boot never destroys, and a live-but-sick instance must not be fed to
    // the sweep (which deletes instances and their data).
    expect(calls).not.toContain("runtime:removeInstance");
    expect(calls.some((c) => c.startsWith("repo:failInstanceMissing")))
      .toBe(false);
    expect(calls).not.toContain("ops:realign:alice");
  });

  it("orphan instance with no DB row: counted + left untouched", async () => {
    const calls: Calls = [];
    const orphan = { name: "ghost", state: "running" as ContainerState };
    const summary = await build(calls, { instances: [running, orphan] })
      .run();

    expect(summary.orphaned).toBe(1);
    expect(calls).not.toContain("runtime:ensureRunning:ghost");
    expect(calls).not.toContain("runtime:removeInstance");
  });

  it("runtime unreachable: reconcile skipped, boot survives", async () => {
    const calls: Calls = [];
    const summary = await build(calls, { listError: new Error("no daemon") })
      .run();

    expect(summary).toEqual({
      started: 0,
      healthy: 0,
      recovered: 0,
      failed: 0,
      orphaned: 0,
      degraded: 0,
    });
  });

  it("one instance erroring never aborts the others", async () => {
    const calls: Calls = [];
    const bobRow = { ...ROW, instanceId: 11, tsHostname: "bob" };
    const summary = await build(calls, {
      rows: [ROW, bobRow],
      // alice's instance exists and is healthy; bob's is absent, its data is
      // gone, and the DB fail-flip blows up — bob must not take alice down.
      instances: [running],
      hasDataFor: (name) => name !== "bob",
      repo: {
        failInstanceMissing: () => Promise.reject(new Error("db locked")),
      },
    }).run();

    expect(summary.healthy).toBe(1);
    expect(summary.degraded).toBe(1);
    expect(calls).toContain("ops:realign:alice");
  });
});
