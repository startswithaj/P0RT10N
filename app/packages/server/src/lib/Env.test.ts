import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Env } from "./Env.ts";

describe("Env", () => {
  // Required vars supplied by default; construction validates them.
  const REQUIRED = {
    P0RT1ON_MASTER_KEY: "k",
    TAILSCALE_OAUTH_CLIENT_SECRET: "tok",
  };
  const env = (map: Record<string, string>) =>
    new Env({ get: (k) => ({ ...REQUIRED, ...map })[k] });

  it("uses defaults when nothing optional is set", () => {
    const e = env({});
    expect(e.logLevel).toBe("info");
    expect(e.port).toBe(8080);
    expect(e.auditPort).toBe(8081);
    expect(e.auditBindHost).toBe("0.0.0.0");
    expect(e.dbPath).toBe("./data/p0rt1on.db");

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

  it("rejects non-numeric values for numeric vars, naming the variable", () => {
    expect(() => env({ PORT: "abc" }).port).toThrow(
      'PORT must be a number, got "abc"',
    );
    expect(() => env({ MINIO_PORT_MIN: "abc" }).provisioningConfig())
      .toThrow("MINIO_PORT_MIN");
  });

  it("rejects an audit port that collides with the admin port", () => {
    // The whole point of the split is two distinct listeners — a collision
    // must fail at boot, not surface as a bind error.
    expect(() => env({ AUDIT_PORT: "8080" }).auditPort).toThrow(
      "must differ from PORT",
    );
    expect(() => env({ PORT: "9000", AUDIT_PORT: "9000" }).auditPort).toThrow(
      "must differ from PORT",
    );
    expect(env({ PORT: "9000" }).auditPort).toBe(8081);
  });

  it("falls back to info for an unknown log level", () => {
    expect(env({ LOG_LEVEL: "bogus" }).logLevel).toBe("info");
  });

  it("construction fails naming every missing required var", () => {
    expect(() => new Env({ get: () => undefined })).toThrow(
      "P0RT1ON_MASTER_KEY, TAILSCALE_OAUTH_CLIENT_SECRET is not set",
    );
    expect(() =>
      new Env({
        get: (k) => ({ P0RT1ON_MASTER_KEY: "k" } as Record<string, string>)[k],
      })
    ).toThrow("TAILSCALE_OAUTH_CLIENT_SECRET is not set");
    // Empty string counts as unset.
    expect(() =>
      new Env({
        get: (k) => ({ ...REQUIRED, P0RT1ON_MASTER_KEY: "" })[k],
      })
    ).toThrow("P0RT1ON_MASTER_KEY is not set");
  });

  it("exposes the required secrets once constructed", () => {
    expect(env({}).masterKey).toBe("k");
    expect(env({}).tailscaleOauthClientSecret).toBe("tok");
  });
});
