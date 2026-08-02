import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  RuntimeInventoryService,
  type StatusInstanceRow,
} from "./InventoryService.ts";
import type { InstanceHealth, InstanceRuntime } from "../runtime/runtime.ts";
import { mockInstanceRuntime } from "../test-helpers/mocks.ts";
import { noopLogger } from "../test-helpers/mocks.ts";

describe("RuntimeInventoryService", () => {
  const runtimeWith = (
    healthFor: (name: string) => InstanceHealth,
    hasData = true,
    // Defaults to the docker-style format explicitly, not because the mock
    // knows about docker — a real runtime supplies whatever it provisioned.
    workloadNameFor: (name: string) => string = (name) =>
      `p0rt1on-instance-${name}`,
  ): InstanceRuntime => ({
    ...mockInstanceRuntime([], {
      healthFor,
      hasDataFor: () => hasData,
      workloadNameFor,
    }),
    diagnoseInstance: (name) =>
      Promise.resolve({
        // Diagnostics carry the real (container) resource name.
        name: `p0rt1on-instance-${name}`,
        state: "running",
        health: healthFor(name),
        healthReason: null,
        exitCode: null,
        exitError: null,
        recentLogs: "logs",
      }),
  });

  const instance = (status: string): StatusInstanceRow => ({
    kind: "dedicated",
    tsHostname: "alice",
    minioPort: 9000,
    status,
    tsTag: "tag:p0rt1on-serve",
  });

  const svcOf = (
    health: InstanceHealth,
    status = "active",
    hasData = true,
    series = new Map<string, number[]>(),
  ) =>
    new RuntimeInventoryService(
      {
        instancesForStatus: () => Promise.resolve([instance(status)]),
        requestSeriesByInstance: () => Promise.resolve(series),
      },
      runtimeWith(() => health, hasData),
      noopLogger(),
    );

  it("healthy → up; tailscale row shows the tag + serve URL", async () => {
    const snap = await svcOf("healthy").snapshot();
    expect(snap.minio[0].name).toBe("p0rt1on-instance-alice");
    expect(snap.minio[0].state).toBe("up");
    // Every MinIO row carries a series (empty here ⇒ flat baseline); tailscale
    // rows never do — that's what distinguishes an activity row.
    expect(snap.minio[0].spark).toEqual([]);
    expect(snap.tailscale[0].spark).toBeUndefined();
    expect(snap.tailscale[0].state).toBe("up"); // same container
    expect(snap.tailscale[0].detail).toBe("tag:p0rt1on-serve");
    expect(snap.host[0].state).toBe("up");
  });

  it("minio row name comes from the runtime's workloadName, not a hardcoded docker format", async () => {
    // A k8s-shaped name proves InventoryService no longer assumes docker.
    const snap = await new RuntimeInventoryService(
      {
        instancesForStatus: () => Promise.resolve([instance("active")]),
        requestSeriesByInstance: () => Promise.resolve(new Map()),
      },
      runtimeWith(() => "healthy", true, (name) => `${name}-0`),
      noopLogger(),
    ).snapshot();
    expect(snap.minio[0].name).toBe("alice-0");
  });

  it("attaches the per-instance request series to its MinIO row", async () => {
    const series = new Map([["alice", [0, 2, 0, 5]]]);
    const snap = await svcOf("healthy", "active", true, series).snapshot();
    expect(snap.minio[0].spark).toEqual([0, 2, 0, 5]);
  });

  it("starting container → provisioning", async () => {
    const snap = await svcOf("starting").snapshot();
    expect(snap.minio[0].state).toBe("provisioning");
  });

  it("db status provisioning → provisioning even if health is unknown", async () => {
    const snap = await svcOf("unknown", "provisioning").snapshot();
    expect(snap.minio[0].state).toBe("provisioning");
  });

  it("db status reaping → pending even when the probe fails (teardown)", async () => {
    const snap = await svcOf("unhealthy", "reaping").snapshot();
    expect(snap.minio[0].state).toBe("pending");
    expect(snap.tailscale[0].state).toBe("pending");
  });

  it("unhealthy but data survives → down (recoverable) on both rows", async () => {
    const snap = await svcOf("unhealthy").snapshot();
    expect(snap.minio[0].state).toBe("down");
    expect(snap.tailscale[0].state).toBe("down");
  });

  it("unhealthy AND data gone → lost (backups unrecoverable)", async () => {
    const snap = await svcOf("unhealthy", "failed", false).snapshot();
    expect(snap.minio[0].state).toBe("lost");
    expect(snap.tailscale[0].state).toBe("lost");
  });

  it("a provisioning instance with no data yet is provisioning, never lost", async () => {
    // Empty pantry dir during provisioning must not read as data loss.
    const snap = await svcOf("unknown", "provisioning", false).snapshot();
    expect(snap.minio[0].state).toBe("provisioning");
  });

  it("diagnose delegates to the runtime by instance name", async () => {
    const svc = new RuntimeInventoryService(
      {
        instancesForStatus: () => Promise.resolve([]),
        requestSeriesByInstance: () => Promise.resolve(new Map()),
      },
      runtimeWith(() => "unhealthy"),
      noopLogger(),
    );
    const d = await svc.diagnose("alice");
    expect(d.name).toBe("p0rt1on-instance-alice");
    expect(d.health).toBe("unhealthy");
  });

  it("returns only the host when there are no instances", async () => {
    const svc = new RuntimeInventoryService(
      {
        instancesForStatus: () => Promise.resolve([]),
        requestSeriesByInstance: () => Promise.resolve(new Map()),
      },
      runtimeWith(() => "unknown"),
      noopLogger(),
    );
    const snap = await svc.snapshot();
    expect(snap.minio).toEqual([]);
    expect(snap.host.length).toBe(1);
  });
});
