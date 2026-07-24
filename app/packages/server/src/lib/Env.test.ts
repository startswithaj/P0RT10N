import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Env } from "./Env.ts";

describe("Env", () => {
  // Required vars supplied by default; construction validates them.
  const REQUIRED = {
    P0RT1ON_MASTER_KEY: "k",
    P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET: "tok",
    // Required on the default (docker) runtime — the pantry host path.
    P0RT1ON_PANTRY: "/srv/p0rt1on",
  };

  const env = (map: Record<string, string>) =>
    new Env({ get: (k) => ({ ...REQUIRED, ...map })[k] });

  it("uses defaults when nothing optional is set", () => {
    const e = env({});
    expect(e.logLevel).toBe("info");
    expect(e.port).toBe(8080);
    expect(e.minioForwardUrl).toBeUndefined();
    expect(e.minioForwardAuthorization).toBeUndefined();
    expect(e.dbPath).toBe("./data/p0rt1on.db");

    const c = e.provisioningConfig();
    expect(c.instanceImage).toBe("p0rt1on-instance:latest");
    expect(c.serveNodeTag).toBe("tag:p0rt1on-serve");
    expect(c.portRange).toEqual({ min: 9100, max: 9999 });
    expect(c.aclMode).toBe("auto");
  });

  it("reads the ACL mode, ignoring bogus values", () => {
    expect(
      env({ P0RT1ON_TAILSCALE_ACL_MODE: "manual" }).provisioningConfig()
        .aclMode,
    ).toBe("manual");
    expect(
      env({ P0RT1ON_TAILSCALE_ACL_MODE: "bogus" }).provisioningConfig().aclMode,
    ).toBe("auto");
  });

  it("reads overrides, including numbers", () => {
    const e = env({
      P0RT1ON_LOG_LEVEL: "debug",
      P0RT1ON_PORT: "9999",
      P0RT1ON_INSTANCE_IMAGE: "img:1",
    });
    expect(e.logLevel).toBe("debug");
    expect(e.port).toBe(9999);
    expect(e.tailscaleOauthClientSecret).toBe("tok");
    expect(e.provisioningConfig().instanceImage).toBe("img:1");
  });

  it("reads MinIO event forwarding config", () => {
    const e = env({
      P0RT1ON_MINIO_FORWARD_URL: "https://sink.example/hook",
      P0RT1ON_MINIO_FORWARD_AUTHORIZATION: "Bearer tok",
    });
    expect(e.minioForwardUrl).toBe("https://sink.example/hook");
    expect(e.minioForwardAuthorization).toBe("Bearer tok");
  });

  it("rejects non-numeric values for numeric vars, naming the variable", () => {
    expect(() => env({ P0RT1ON_PORT: "abc" }).port).toThrow(
      'P0RT1ON_PORT must be a number, got "abc"',
    );
  });

  it("rejects an admin port that collides with the audit listener", () => {
    // The whole point of the split is two distinct listeners — a collision
    // must fail at boot, not surface as a bind error.
    expect(() => env({ P0RT1ON_PORT: "8081" }).port).toThrow(
      "must differ from the audit listener's port",
    );
    expect(env({ P0RT1ON_PORT: "9000" }).port).toBe(9000);
  });

  it("falls back to info for an unknown log level", () => {
    expect(env({ P0RT1ON_LOG_LEVEL: "bogus" }).logLevel).toBe("info");
  });

  it("derives where instances post audit events, per runtime", () => {
    // Never 127.0.0.1 — that would be the instance itself, not the manager.
    expect(env({}).provisioningConfig().auditWebhookUrl).toBe(
      "http://host.docker.internal:8081/internal/minio-events",
    );
    expect(
      env({ P0RT1ON_RUNTIME: "kubernetes", P0RT1ON_K8S_NAMESPACE: "portions" })
        .provisioningConfig().auditWebhookUrl,
    ).toBe("http://p0rt1on-manager.portions.svc:8081/internal/minio-events");
  });

  it("construction fails naming every missing required var", () => {
    expect(() => new Env({ get: () => undefined })).toThrow(
      "P0RT1ON_MASTER_KEY, P0RT1ON_PANTRY, " +
        "P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET is not set",
    );
    expect(() =>
      new Env({
        get: (k) => ({ P0RT1ON_MASTER_KEY: "k" } as Record<string, string>)[k],
      })
    ).toThrow("P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET");
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

  it("reads the pantry path", () => {
    expect(env({ P0RT1ON_PANTRY: "/mnt/disk/p0rt1on" }).pantry)
      .toBe("/mnt/disk/p0rt1on");
  });

  it("rejects a non-absolute pantry path", () => {
    expect(() => env({ P0RT1ON_PANTRY: "relative/dir" }).pantry)
      .toThrow("must be an absolute path");
  });

  it("refuses a DB_PATH inside the pantry (different lifecycle)", () => {
    expect(() =>
      env({ P0RT1ON_PANTRY: "/srv/p", P0RT1ON_DB_PATH: "/srv/p/p0rt1on.db" })
        .pantry
    ).toThrow("must not live inside");
    // A DB outside the pantry is fine.
    expect(
      env({ P0RT1ON_PANTRY: "/srv/p", P0RT1ON_DB_PATH: "/var/p0rt1on.db" })
        .pantry,
    ).toBe("/srv/p");
  });

  it("on kubernetes the pantry is a StorageClass name, not a path", () => {
    const k8s = (pantry: string) =>
      new Env({
        get: (k) =>
          ({
            P0RT1ON_MASTER_KEY: "k",
            P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET: "tok",
            P0RT1ON_TAILSCALE_TAG_OWNER: "tag:p0rt1on",
            P0RT1ON_RUNTIME: "kubernetes",
            P0RT1ON_PANTRY: pantry,
          } as Record<string, string>)[k],
      });

    expect(k8s("p0rt1on-pantry").pantry).toBe("p0rt1on-pantry");
    // A path (leading slash) is the docker shape — rejected on k8s.
    expect(() => k8s("/srv/p0rt1on").pantry).toThrow("StorageClass name");
  });

  it("requires the pantry on kubernetes too", () => {
    expect(() =>
      new Env({
        get: (k) =>
          ({
            P0RT1ON_MASTER_KEY: "k",
            P0RT1ON_TAILSCALE_OAUTH_CLIENT_SECRET: "tok",
            P0RT1ON_TAILSCALE_TAG_OWNER: "tag:p0rt1on",
            P0RT1ON_RUNTIME: "kubernetes",
          } as Record<string, string>)[k],
      })
    ).toThrow("P0RT1ON_PANTRY is not set");
  });

  it("headscale backend requires its own vars, not the OAuth secret", () => {
    const headscale = new Env({
      get: (k) =>
        ({
          P0RT1ON_MASTER_KEY: "k",
          P0RT1ON_TAILSCALE_BACKEND: "headscale",
          P0RT1ON_HEADSCALE_URL: "http://hs:8080",
          P0RT1ON_HEADSCALE_API_KEY: "hs-key",
          P0RT1ON_HEADSCALE_BASE_DOMAIN: "hs.test",
          P0RT1ON_PANTRY: "/srv/p0rt1on",
        } as Record<string, string>)[k],
    });
    expect(headscale.tailscaleBackend).toBe("headscale");
    expect(headscale.headscaleSettings()).toEqual({
      baseUrl: "http://hs:8080",
      apiKey: "hs-key",
      user: "p0rt1on",
      baseDomain: "hs.test",
    });

    expect(() =>
      new Env({
        get: (k) =>
          ({
            P0RT1ON_MASTER_KEY: "k",
            P0RT1ON_TAILSCALE_BACKEND: "headscale",
            P0RT1ON_PANTRY: "/srv/p0rt1on",
          } as Record<string, string>)[k],
      })
    ).toThrow(
      "P0RT1ON_HEADSCALE_URL, P0RT1ON_HEADSCALE_API_KEY, " +
        "P0RT1ON_HEADSCALE_BASE_DOMAIN is not set",
    );
  });

  it("defaults to the tailscale backend, ignoring bogus values", () => {
    expect(env({}).tailscaleBackend).toBe("tailscale");
    expect(env({ P0RT1ON_TAILSCALE_BACKEND: "bogus" }).tailscaleBackend)
      .toBe("tailscale");
  });

  it("instanceTailscale: SaaS https by default; headscale derives its login server", () => {
    expect(env({}).instanceTailscale()).toEqual({
      loginServer: undefined,
      serveMode: "https",
    });
    // Headscale derives loginServer from its own URL (same as the API base).
    expect(
      env({
        P0RT1ON_TAILSCALE_BACKEND: "headscale",
        P0RT1ON_HEADSCALE_URL: "http://hs:8080",
        P0RT1ON_HEADSCALE_API_KEY: "hs-key",
        P0RT1ON_HEADSCALE_BASE_DOMAIN: "hs.test",
        P0RT1ON_TAILSCALE_SERVE_MODE: "http",
      }).instanceTailscale(),
    ).toEqual({ loginServer: "http://hs:8080", serveMode: "http" });
    // Anything but the explicit opt-out stays https.
    expect(
      env({ P0RT1ON_TAILSCALE_SERVE_MODE: "bogus" }).instanceTailscale()
        .serveMode,
    ).toBe("https");
  });

  it("admin auth: null unless both username + password set; bind defaults loopback", () => {
    expect(env({}).adminAuth).toBeNull();
    expect(env({ P0RT1ON_ADMIN_USERNAME: "admin" }).adminAuth).toBeNull();
    expect(env({ P0RT1ON_ADMIN_PASSWORD: "pw" }).adminAuth).toBeNull();
    expect(
      env({ P0RT1ON_ADMIN_USERNAME: "admin", P0RT1ON_ADMIN_PASSWORD: "pw" })
        .adminAuth,
    ).toEqual({ username: "admin", password: "pw" });
    expect(env({}).adminBindHost).toBe("127.0.0.1");
    expect(env({ P0RT1ON_ADMIN_BIND_HOST: "0.0.0.0" }).adminBindHost)
      .toBe("0.0.0.0");
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
        P0RT1ON_PORTION_K8S_CPU_REQUEST: "250m",
        P0RT1ON_PORTION_K8S_CPU_LIMIT: "1",
        P0RT1ON_PORTION_K8S_MEMORY_REQUEST: "256Mi",
        P0RT1ON_PORTION_K8S_MEMORY_LIMIT: "1Gi",
      }).kubeSettings().resources,
    ).toEqual({
      cpuRequest: "250m",
      cpuLimit: "1",
      memoryRequest: "256Mi",
      memoryLimit: "1Gi",
    });
    expect(
      env({
        P0RT1ON_PORTION_DOCKER_CPU_REQUEST: "512",
        P0RT1ON_PORTION_DOCKER_CPU_LIMIT: "0.5",
        P0RT1ON_PORTION_DOCKER_MEMORY_REQUEST: "256m",
        P0RT1ON_PORTION_DOCKER_MEMORY_LIMIT: "1g",
      }).dockerPortionResources(),
    ).toEqual({
      cpuShares: "512",
      cpus: "0.5",
      memoryReservation: "256m",
      memoryLimit: "1g",
    });
  });
});
