import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { adminEndpointComposer } from "./adminEndpoint.ts";

describe("adminEndpointComposer", () => {
  const target = { alias: "alice", minioPort: 9100 };

  it("host mode addresses the loopback-published port", () => {
    expect(adminEndpointComposer("host")(target))
      .toBe("http://127.0.0.1:9100");
  });

  it("network mode addresses the instance by container name", () => {
    // Cross-container on Linux, published loopback ports are unreachable —
    // the shared docker network + container name is the only working path.
    expect(adminEndpointComposer("network")(target))
      .toBe("http://p0rt1on-instance-alice:9100");
  });
});
