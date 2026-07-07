import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Env } from "./Env.ts";

describe("Env", () => {
  const env = (map: Record<string, string>) => new Env({ get: (k) => map[k] });

  it("uses defaults when nothing is set", () => {
    const e = env({});
    expect(e.logLevel).toBe("info");
    expect(e.port).toBe(8080);
    expect(e.bindHost).toBe("127.0.0.1");
    expect(e.dbPath).toBe("./data/p0rt1on.db");
    expect(e.tailscaleOauthClientSecret).toBeUndefined();

    const c = e.provisioningConfig();
    expect(c.instanceImage).toBe("p0rt1on-instance:latest");
    expect(c.network).toBe("p0rt1on-net");
    expect(c.serveNodeTag).toBe("tag:p0rt1on-serve");
    expect(c.portRange).toEqual({ min: 9100, max: 9999 });
    expect(c.aclMode).toBe("auto");
  });

  it("reads TAILSCALE_ACL_MODE=manual", () => {
    expect(env({ TAILSCALE_ACL_MODE: "manual" }).provisioningConfig().aclMode)
      .toBe("manual");
    expect(env({ TAILSCALE_ACL_MODE: "bogus" }).provisioningConfig().aclMode)
      .toBe("auto");
  });

  it("reads overrides, including numbers", () => {
    const e = env({
      LOG_LEVEL: "debug",
      PORT: "9999",
      INSTANCE_IMAGE: "img:1",
      MINIO_PORT_MIN: "9200",
      TAILSCALE_OAUTH_CLIENT_SECRET: "tok",
    });
    expect(e.logLevel).toBe("debug");
    expect(e.port).toBe(9999);
    expect(e.tailscaleOauthClientSecret).toBe("tok");
    expect(e.provisioningConfig().instanceImage).toBe("img:1");
    expect(e.provisioningConfig().portRange.min).toBe(9200);
  });

  it("falls back to info for an unknown log level", () => {
    expect(env({ LOG_LEVEL: "bogus" }).logLevel).toBe("info");
  });

  it("requireMasterKey throws when unset and returns it when set", () => {
    expect(() => env({}).requireMasterKey()).toThrow("P0RT1ON_MASTER_KEY");
    expect(env({ P0RT1ON_MASTER_KEY: "k" }).requireMasterKey()).toBe("k");
  });
});
