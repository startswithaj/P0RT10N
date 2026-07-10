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
  ): InstanceRuntime => ({
    ...mockInstanceRuntime([], { healthFor }),
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

  const svcOf = (health: InstanceHealth, status = "active") =>
    new RuntimeInventoryService(
      { instancesForStatus: () => Promise.resolve([instance(status)]) },
      runtimeWith(() => health),
      "tail1a2b.ts.net",
      noopLogger(),
    );

  it("healthy → up; tailscale row shows the tag + serve URL", async () => {
    const snap = await svcOf("healthy").snapshot();
    expect(snap.minio[0].name).toBe("p0rt1on-instance-alice");
    expect(snap.minio[0].state).toBe("up");
    expect(snap.tailscale[0].state).toBe("up"); // same container
    expect(snap.tailscale[0].detail).toBe(
      "tag:p0rt1on-serve · https://alice.tail1a2b.ts.net",
    );
    expect(snap.host[0].state).toBe("up");
  });

  it("starting container → provisioning", async () => {
    const snap = await svcOf("starting").snapshot();
    expect(snap.minio[0].state).toBe("provisioning");
  });

  it("db status provisioning → provisioning even if health is unknown", async () => {
    const snap = await svcOf("unknown", "provisioning").snapshot();
    expect(snap.minio[0].state).toBe("provisioning");
  });

  it("unhealthy → down on both rows", async () => {
    const snap = await svcOf("unhealthy").snapshot();
    expect(snap.minio[0].state).toBe("down");
    expect(snap.tailscale[0].state).toBe("down");
  });

  it("diagnose delegates to the runtime by instance name", async () => {
    const svc = new RuntimeInventoryService(
      { instancesForStatus: () => Promise.resolve([]) },
      runtimeWith(() => "unhealthy"),
      "tail1a2b.ts.net",
      noopLogger(),
    );
    const d = await svc.diagnose("alice");
    expect(d.name).toBe("p0rt1on-instance-alice");
    expect(d.health).toBe("unhealthy");
  });

  it("returns only the host when there are no instances", async () => {
    const svc = new RuntimeInventoryService(
      { instancesForStatus: () => Promise.resolve([]) },
      runtimeWith(() => "unknown"),
      "tail1a2b.ts.net",
      noopLogger(),
    );
    const snap = await svc.snapshot();
    expect(snap.minio).toEqual([]);
    expect(snap.host.length).toBe(1);
  });
});
