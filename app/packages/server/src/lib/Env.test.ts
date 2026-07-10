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
    expect(e.dockerNetwork).toBe("p0rt1on-net");
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

  it("headscale backend requires its own vars, not the OAuth secret", () => {
    const headscale = new Env({
      get: (k) =>
        ({
          P0RT1ON_MASTER_KEY: "k",
          TAILSCALE_BACKEND: "headscale",
          HEADSCALE_URL: "http://hs:8080",
          HEADSCALE_API_KEY: "hs-key",
        } as Record<string, string>)[k],
    });
    expect(headscale.tailscaleBackend).toBe("headscale");
    expect(headscale.headscaleSettings()).toEqual({
      baseUrl: "http://hs:8080",
      apiKey: "hs-key",
      user: "p0rt1on",
    });

    expect(() =>
      new Env({
        get: (k) =>
          ({
            P0RT1ON_MASTER_KEY: "k",
            TAILSCALE_BACKEND: "headscale",
          } as Record<string, string>)[k],
      })
    ).toThrow("HEADSCALE_URL, HEADSCALE_API_KEY is not set");
  });

  it("defaults to the tailscale backend, ignoring bogus values", () => {
    expect(env({}).tailscaleBackend).toBe("tailscale");
    expect(env({ TAILSCALE_BACKEND: "bogus" }).tailscaleBackend)
      .toBe("tailscale");
  });

  it("instanceTailscale defaults to SaaS https; reads the http override", () => {
    expect(env({}).instanceTailscale()).toEqual({
      loginServer: undefined,
      serveMode: "https",
    });
    expect(
      env({
        TAILSCALE_LOGIN_SERVER: "http://hs:8080",
        TAILSCALE_SERVE_MODE: "http",
      }).instanceTailscale(),
    ).toEqual({ loginServer: "http://hs:8080", serveMode: "http" });
    // Anything but the explicit opt-out stays https.
    expect(env({ TAILSCALE_SERVE_MODE: "bogus" }).instanceTailscale().serveMode)
      .toBe("https");
  });

  it("admin auth: null unless both username + password set; bind defaults loopback", () => {
    expect(env({}).adminAuth).toBeNull();
    expect(env({ ADMIN_USERNAME: "admin" }).adminAuth).toBeNull();
    expect(env({ ADMIN_PASSWORD: "pw" }).adminAuth).toBeNull();
    expect(env({ ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "pw" }).adminAuth)
      .toEqual({ username: "admin", password: "pw" });
    expect(env({}).adminBindHost).toBe("127.0.0.1");
    expect(env({ ADMIN_BIND_HOST: "0.0.0.0" }).adminBindHost).toBe("0.0.0.0");
  });

  it("portion resources are all unset by default (no caps)", () => {
    expect(env({}).kubeSettings().resources).toEqual({
      cpuRequest: undefined,
      cpuLimit: undefined,
      memoryRequest: undefined,
      memoryLimit: undefined,
    });
    expect(env({}).dockerPortionResources()).toEqual({
      cpuShares: undefined,
      cpus: undefined,
      memoryReservation: undefined,
      memoryLimit: undefined,
    });
  });

  it("reads the per-portion k8s + docker resource vars", () => {
    expect(
      env({
        PORTION_K8S_CPU_REQUEST: "250m",
        PORTION_K8S_CPU_LIMIT: "1",
        PORTION_K8S_MEMORY_REQUEST: "256Mi",
        PORTION_K8S_MEMORY_LIMIT: "1Gi",
      }).kubeSettings().resources,
    ).toEqual({
      cpuRequest: "250m",
      cpuLimit: "1",
      memoryRequest: "256Mi",
      memoryLimit: "1Gi",
    });
    expect(
      env({
        PORTION_DOCKER_CPU_REQUEST: "512",
        PORTION_DOCKER_CPU_LIMIT: "0.5",
        PORTION_DOCKER_MEMORY_REQUEST: "256m",
        PORTION_DOCKER_MEMORY_LIMIT: "1g",
      }).dockerPortionResources(),
    ).toEqual({
      cpuShares: "512",
      cpus: "0.5",
      memoryReservation: "256m",
      memoryLimit: "1g",
    });
  });
});
