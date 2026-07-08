import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { ContainerHandle } from "../runtime/runtime.ts";
import type { ProvisioningRepo } from "../provisioning/deps.ts";
import {
  type Calls,
  DEDICATED_RES,
  mockContainerRuntime,
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
  const CONTAINER = "p0rt1on-instance-alice";
  const running: ContainerHandle = {
    name: CONTAINER,
    id: "1",
    state: "running",
  };
  const stopped: ContainerHandle = {
    name: CONTAINER,
    id: "1",
    state: "stopped",
  };

  function build(
    calls: Calls,
    opts: {
      rows?: typeof ROW[];
      containers?: ContainerHandle[];
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
      mockContainerRuntime(calls, opts),
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
    const summary = await build(calls, { containers: [running] }).run();

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
    expect(calls).toContain(`docker:start:${CONTAINER}`);
  });

  it("stopped: starts it, verifies health, then re-issues config", async () => {
    const calls: Calls = [];
    const summary = await build(calls, { containers: [stopped] }).run();

    expect(summary.started).toBe(1);
    expect(calls.indexOf(`docker:start:${CONTAINER}`)).toBeLessThan(
      calls.indexOf("mc:setAuditWebhook"),
    );
  });

  it("absent container: fails the instance + friends, never realigns", async () => {
    const calls: Calls = [];
    const summary = await build(calls, { containers: [] }).run();

    expect(summary.failed).toBe(1);
    expect(calls).toContain("repo:failInstanceMissing:10");
    expect(calls).not.toContain("mc:setAuditWebhook");
  });

  it("unhealthy after the bounded wait: logged as degraded, NOTHING deleted or marked", async () => {
    const calls: Calls = [];
    const summary = await build(calls, {
      containers: [running],
      healthFor: () => "unhealthy",
    }).run();

    expect(summary.degraded).toBe(1);
    // Boot never destroys, and a live-but-sick instance must not be fed to
    // the sweep (which deletes volumes).
    expect(calls).not.toContain(`docker:remove:${CONTAINER}`);
    expect(calls.some((c) => c.startsWith("repo:failInstanceMissing")))
      .toBe(false);
    expect(calls).not.toContain("mc:setAuditWebhook");
  });

  it("orphan labelled container: counted + left untouched", async () => {
    const calls: Calls = [];
    const orphan: ContainerHandle = {
      name: "p0rt1on-instance-ghost",
      id: "9",
      state: "running",
    };
    const summary = await build(calls, { containers: [running, orphan] })
      .run();

    expect(summary.orphaned).toBe(1);
    expect(calls).not.toContain("docker:start:p0rt1on-instance-ghost");
    expect(calls).not.toContain("docker:remove:p0rt1on-instance-ghost");
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
      // alice's container exists and is healthy; bob's is absent AND the DB
      // flip for it blows up — bob must not take alice down with him.
      containers: [running],
      repo: {
        failInstanceMissing: () => Promise.reject(new Error("db locked")),
      },
    }).run();

    expect(summary.healthy).toBe(1);
    expect(summary.degraded).toBe(1);
    expect(calls).toContain("mc:setAuditWebhook");
  });
});
