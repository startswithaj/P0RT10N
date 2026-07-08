import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { ContainerState } from "../runtime/runtime.ts";
import type { ProvisioningRepo } from "../provisioning/deps.ts";
import {
  type Calls,
  DEDICATED_RES,
  mockInstanceRuntime,
  mockMcClient,
  mockMcFactory,
  mockProvisioningRepo,
  noopLogger,
} from "../test-helpers/mocks.ts";
import { BootReconciler } from "./BootReconciler.ts";

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
      listError?: Error;
      repo?: Partial<ProvisioningRepo>;
    } = {},
  ) {
    return new BootReconciler(
      mockProvisioningRepo(calls, DEDICATED_RES, {
        liveInstances: () => Promise.resolve(opts.rows ?? [ROW]),
        ...opts.repo,
      }),
      mockInstanceRuntime(calls, opts),
      mockMcFactory(mockMcClient(calls)),
      {
        auditWebhookUrl: "http://m/audit",
        auditWebhookToken: "tok",
      },
      noopLogger(),
      { attempts: 2, delayMs: 0 }, // bounded wait, no real sleeping in tests
    );
  }

  it("running + healthy: re-issues the audit webhook, touches nothing else", async () => {
    const calls: Calls = [];
    const summary = await build(calls, { instances: [running] }).run();

    expect(summary).toEqual({
      started: 0,
      healthy: 1,
      failed: 0,
      orphaned: 0,
      degraded: 0,
    });
    expect(calls).toContain("mc:setAuditWebhook");
    // Adopt runs even when healthy — it converges config drift (restart
    // policy); the actual no-start behaviour is DockerRuntime's, tested there.
    expect(calls).toContain(`runtime:ensureRunning:alice`);
  });

  it("stopped: starts it, verifies health, then re-issues config", async () => {
    const calls: Calls = [];
    const summary = await build(calls, { instances: [stopped] }).run();

    expect(summary.started).toBe(1);
    expect(calls.indexOf(`runtime:ensureRunning:alice`)).toBeLessThan(
      calls.indexOf("mc:setAuditWebhook"),
    );
  });

  it("absent container: fails the instance + friends, never realigns", async () => {
    const calls: Calls = [];
    const summary = await build(calls, { instances: [] }).run();

    expect(summary.failed).toBe(1);
    expect(calls).toContain("repo:failInstanceMissing:10");
    expect(calls).not.toContain("mc:setAuditWebhook");
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
    expect(calls).not.toContain("mc:setAuditWebhook");
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

  it("docker unreachable: reconcile skipped, boot survives", async () => {
    const calls: Calls = [];
    const summary = await build(calls, { listError: new Error("no daemon") })
      .run();

    expect(summary).toEqual({
      started: 0,
      healthy: 0,
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
      // alice's instance exists and is healthy; bob's is absent AND the DB
      // flip for it blows up — bob must not take alice down with him.
      instances: [running],
      repo: {
        failInstanceMissing: () => Promise.reject(new Error("db locked")),
      },
    }).run();

    expect(summary.healthy).toBe(1);
    expect(summary.degraded).toBe(1);
    expect(calls).toContain("mc:setAuditWebhook");
  });
});
