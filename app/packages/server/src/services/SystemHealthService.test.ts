import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  buildHealthProbes,
  type SystemHealthConfig,
  SystemHealthServiceImpl,
} from "./SystemHealthService.ts";
import {
  mockTailscaleApi,
  noopLogger,
  testEnv,
} from "../test-helpers/mocks.ts";
import { ServiceError } from "../lib/ServiceError.ts";
import type { TailscaleApi } from "../tailscale/tailscale.ts";
import type { RestClient } from "@cloudydeno/kubernetes-client";
import type { HealthCheckId, HealthStatus } from "@p0rt1on/shared/domain";

describe("SystemHealthServiceImpl", () => {
  const NOW = () => Date.parse("2026-06-30T12:00:00Z");
  const BASE: SystemHealthConfig = {
    serveMode: "https",
    serveNodeTag: "tag:p0rt1on-serve",
    aclMode: "auto",
    // Docker default: no k8s probes, so managerService/pantry are
    // omitted entirely and instanceImage never warns.
    runtimeKind: "docker",
    instanceImage: "p0rt1on-instance:latest",
  };

  const service = (ts: TailscaleApi, over: Partial<SystemHealthConfig> = {}) =>
    new SystemHealthServiceImpl(ts, { ...BASE, ...over }, noopLogger(), NOW);

  const statusOf = (
    checks: { id: HealthCheckId; status: HealthStatus }[],
    id: HealthCheckId,
  ): HealthStatus | undefined => checks.find((c) => c.id === id)?.status;

  it("healthy https tailnet: nothing blocked, can provision", async () => {
    const ts = mockTailscaleApi([]); // magicDns + isTagOwned both true
    const h = await service(ts).probe();
    expect(h.canProvision).toBe(true);
    expect(statusOf(h.checks, "tailscaleApi")).toBe("ok");
    expect(statusOf(h.checks, "magicDns")).toBe("ok");
    expect(statusOf(h.checks, "serveTag")).toBe("ok");
    // httpsEnabled is read directly from the API → definitive ok.
    expect(statusOf(h.checks, "httpsServe")).toBe("ok");
  });

  it("HTTPS certificates off blocks (read directly from the API)", async () => {
    const ts = mockTailscaleApi([]);
    ts.httpsCertsEnabled = () => Promise.resolve(false);
    const h = await service(ts).probe();
    expect(statusOf(h.checks, "httpsServe")).toBe("blocked");
    expect(h.canProvision).toBe(false);
  });

  it("missing networking_settings:read scope warns, doesn't block", async () => {
    const ts = mockTailscaleApi([]);
    ts.httpsCertsEnabled = () =>
      Promise.reject(new ServiceError("FORBIDDEN", "no scope"));
    const h = await service(ts).probe();
    expect(statusOf(h.checks, "httpsServe")).toBe("warn");
    // A 403 means the API is reachable — creds are fine, just a missing scope.
    expect(statusOf(h.checks, "tailscaleApi")).toBe("ok");
    expect(h.canProvision).toBe(true);
  });

  it("MagicDNS off blocks (https prerequisite unmet)", async () => {
    const ts = mockTailscaleApi([]);
    ts.magicDnsEnabled = () => Promise.resolve(false);
    const h = await service(ts).probe();
    expect(statusOf(h.checks, "magicDns")).toBe("blocked");
    expect(h.canProvision).toBe(false);
  });

  it("auto mode declares the serve tag when absent", async () => {
    const calls: string[] = [];
    const ts = mockTailscaleApi(calls);
    ts.isTagOwned = () => Promise.resolve(false);
    const h = await service(ts).probe();
    expect(statusOf(h.checks, "serveTag")).toBe("ok");
    expect(calls).toContain("ts:ensureTagOwner:tag:p0rt1on-serve");
  });

  it("blocks when the token can't write the policy (403)", async () => {
    const ts = mockTailscaleApi([]);
    ts.isTagOwned = () => Promise.resolve(false);
    ts.ensureTagOwner = () =>
      Promise.reject(new ServiceError("FORBIDDEN", "nope"));
    const h = await service(ts).probe();
    expect(statusOf(h.checks, "serveTag")).toBe("blocked");
    expect(h.canProvision).toBe(false);
  });

  it("manual mode never writes: absent serve tag blocks", async () => {
    const calls: string[] = [];
    const ts = mockTailscaleApi(calls);
    ts.isTagOwned = () => Promise.resolve(false);
    const h = await service(ts, { aclMode: "manual" }).probe();
    expect(statusOf(h.checks, "serveTag")).toBe("blocked");
    expect(calls).not.toContain("ts:ensureTagOwner:tag:p0rt1on-serve");
  });

  it("a policy read error warns (doesn't block)", async () => {
    const ts = mockTailscaleApi([]);
    ts.isTagOwned = () => Promise.reject(new Error("boom"));
    const h = await service(ts).probe();
    expect(statusOf(h.checks, "serveTag")).toBe("warn");
  });

  it("http serve mode: MagicDNS + HTTPS are moot, both ok", async () => {
    const ts = mockTailscaleApi([]);
    ts.magicDnsEnabled = () => Promise.resolve(false);
    const h = await service(ts, { serveMode: "http" }).probe();
    expect(statusOf(h.checks, "magicDns")).toBe("ok");
    expect(statusOf(h.checks, "httpsServe")).toBe("ok");
    expect(h.canProvision).toBe(true);
  });

  it("API unreachable (both reads fail non-403) blocks", async () => {
    const ts = mockTailscaleApi([]);
    ts.magicDnsEnabled = () => Promise.reject(new Error("network down"));
    ts.httpsCertsEnabled = () => Promise.reject(new Error("network down"));
    const h = await service(ts).probe();
    expect(statusOf(h.checks, "tailscaleApi")).toBe("blocked");
    expect(h.canProvision).toBe(false);
  });

  it("reportServeUnavailable latches httpsServe to blocked", async () => {
    const ts = mockTailscaleApi([]);
    const svc = service(ts);
    await svc.probe();
    expect(svc.current().canProvision).toBe(true);
    svc.reportServeUnavailable("serve is not enabled on your tailnet");
    expect(statusOf(svc.current().checks, "httpsServe")).toBe("blocked");
    expect(svc.current().canProvision).toBe(false);
  });

  it("reportServeUnavailable is a no-op in http mode", async () => {
    const ts = mockTailscaleApi([]);
    const svc = service(ts, { serveMode: "http" });
    await svc.probe();
    svc.reportServeUnavailable("ignored");
    expect(svc.current().canProvision).toBe(true);
  });

  it("current() is optimistic before the first probe", () => {
    const svc = service(mockTailscaleApi([]));
    expect(svc.current().canProvision).toBe(true);
    expect(svc.current().checks).toEqual([]);
  });

  describe("managerService (k8s boot check)", () => {
    it("resolves: ok, can provision", async () => {
      const ts = mockTailscaleApi([]);
      const h = await service(ts, {
        probeManagerService: () =>
          Promise.resolve({
            ok: true,
            service: "p0rt1on-manager",
            namespace: "p0rt1on",
          }),
      }).probe();
      expect(statusOf(h.checks, "managerService")).toBe("ok");
      expect(h.canProvision).toBe(true);
    });

    it("does not resolve: blocked, gates provisioning", async () => {
      const ts = mockTailscaleApi([]);
      const h = await service(ts, {
        probeManagerService: () =>
          Promise.resolve({
            ok: false,
            service: "wrong-name",
            namespace: "p0rt1on",
            error: 'services "wrong-name" not found',
          }),
      }).probe();
      const check = h.checks.find((c) => c.id === "managerService");
      expect(check?.status).toBe("blocked");
      expect(check?.detail).toContain("wrong-name");
      expect(check?.detail).toContain("P0RT1ON_K8S_MANAGER_SERVICE_NAME");
      expect(h.canProvision).toBe(false);
    });

    it("absent on docker: check omitted entirely, not a passing ok", async () => {
      const ts = mockTailscaleApi([]);
      const h = await service(ts).probe(); // BASE has no probeManagerService
      expect(h.checks.find((c) => c.id === "managerService")).toBeUndefined();
    });
  });

  describe("instanceImage (preflight)", () => {
    it("k8s + unqualified image: warns, names the image and the var", async () => {
      const ts = mockTailscaleApi([]);
      const h = await service(ts, {
        runtimeKind: "kubernetes",
        instanceImage: "p0rt1on-instance:latest",
      }).probe();
      const check = h.checks.find((c) => c.id === "instanceImage");
      expect(check?.status).toBe("warn");
      expect(check?.detail).toContain("p0rt1on-instance:latest");
      expect(check?.detail).toContain("P0RT1ON_INSTANCE_IMAGE");
      expect(h.canProvision).toBe(true); // warn, never blocked
    });

    it("k8s + registry-qualified image: ok", async () => {
      const ts = mockTailscaleApi([]);
      const h = await service(ts, {
        runtimeKind: "kubernetes",
        instanceImage: "registry.example.com/p0rt1on-instance:latest",
      }).probe();
      expect(statusOf(h.checks, "instanceImage")).toBe("ok");
    });

    it("docker: check omitted entirely", async () => {
      const ts = mockTailscaleApi([]);
      const h = await service(ts, {
        runtimeKind: "docker",
        instanceImage: "p0rt1on-instance:latest",
      }).probe();
      expect(h.checks.find((c) => c.id === "instanceImage")).toBeUndefined();
    });
  });

  describe("pantry (k8s boot check)", () => {
    it("not the cluster default: ok, and names what the default is", async () => {
      const ts = mockTailscaleApi([]);
      const h = await service(ts, {
        probePantry: () =>
          Promise.resolve({
            ok: true,
            className: "p0rt1on-pantry",
            clusterDefault: "local-path",
          }),
      }).probe();
      expect(statusOf(h.checks, "pantry")).toBe("ok");
      expect(h.checks.find((c) => c.id === "pantry")?.detail)
        .toContain("local-path");
      expect(h.canProvision).toBe(true);
    });

    it("no cluster default at all: still ok", async () => {
      const ts = mockTailscaleApi([]);
      const h = await service(ts, {
        probePantry: () =>
          Promise.resolve({
            ok: true,
            className: "p0rt1on-pantry",
            clusterDefault: null,
          }),
      }).probe();
      expect(statusOf(h.checks, "pantry")).toBe("ok");
    });

    it("is the cluster default: blocked", async () => {
      const ts = mockTailscaleApi([]);
      const h = await service(ts, {
        probePantry: () =>
          Promise.resolve({
            ok: false,
            className: "standard",
            reason: "is-default",
          }),
      }).probe();
      const check = h.checks.find((c) => c.id === "pantry");
      expect(check?.status).toBe("blocked");
      expect(check?.detail).toContain("default");
      expect(h.canProvision).toBe(false);
    });

    it("unverifiable (RBAC/network error): warns, doesn't block", async () => {
      const ts = mockTailscaleApi([]);
      const h = await service(ts, {
        probePantry: () =>
          Promise.resolve({
            ok: false,
            className: "p0rt1on-pantry",
            reason: "unverifiable",
            error: "storageclasses.storage.k8s.io is forbidden",
          }),
      }).probe();
      const check = h.checks.find((c) => c.id === "pantry");
      expect(check?.status).toBe("warn");
      expect(h.canProvision).toBe(true);
    });

    it("absent on docker: check omitted entirely", async () => {
      const ts = mockTailscaleApi([]);
      const h = await service(ts).probe();
      expect(h.checks.find((c) => c.id === "pantry")).toBeUndefined();
    });
  });
});

describe("buildHealthProbes (k8s boot-check composition)", () => {
  type Reply = { status?: number; json?: unknown };

  const fakeKubeClient = (
    reply: () => Reply,
    recorded?: { method: string; query: string }[],
  ): RestClient => {
    // deno-lint-ignore no-explicit-any
    const perform = (opts: any): Promise<unknown> => {
      recorded?.push({
        method: opts.method,
        query: String(opts.querystring ?? ""),
      });
      const r = reply();
      if (r.status && r.status >= 400) {
        const err = new Error(`Kubernetes returned HTTP ${r.status}`);
        (err as { httpCode?: number }).httpCode = r.status;
        return Promise.reject(err);
      }
      if (opts.expectJson) return Promise.resolve(r.json ?? {});
      return Promise.resolve(new TextEncoder().encode(""));
    };

    return {
      performRequest: perform,
      close() {},
      [Symbol.dispose]() {},
      // deno-lint-ignore no-explicit-any
    } as any;
  };

  const k8sEnv = () =>
    testEnv({
      P0RT1ON_RUNTIME: "kubernetes",
      P0RT1ON_PANTRY: "p0rt1on-pantry",
      P0RT1ON_K8S_MANAGER_SERVICE_NAME: "p0rt1on-manager",
    });

  it("docker runtime: no probes composed", () => {
    const probes = buildHealthProbes(testEnv(), undefined);
    expect(probes.probeManagerService).toBeUndefined();
    expect(probes.probePantry).toBeUndefined();
  });

  it("kubernetes runtime, no client built yet: no probes composed", () => {
    const probes = buildHealthProbes(k8sEnv(), undefined);
    expect(probes.probeManagerService).toBeUndefined();
  });

  it("probeManagerService: resolves", async () => {
    const client = fakeKubeClient(() => ({ json: {} }));
    const probes = buildHealthProbes(k8sEnv(), client);
    const result = await probes.probeManagerService?.();
    expect(result).toEqual({
      ok: true,
      service: "p0rt1on-manager",
      namespace: "p0rt1on",
    });
  });

  it("probeManagerService: does not resolve, names the Service and namespace", async () => {
    const client = fakeKubeClient(() => ({
      status: 404,
      json: { message: 'services "p0rt1on-manager" not found' },
    }));
    const probes = buildHealthProbes(k8sEnv(), client);
    const result = await probes.probeManagerService?.();
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.service).toBe("p0rt1on-manager");
      expect(result.namespace).toBe("p0rt1on");
      expect(result.error).toContain("404");
    }
  });

  it("probePantry: asks admission for the default without creating a PVC", async () => {
    const recorded: { method: string; query: string }[] = [];
    const client = fakeKubeClient(
      () => ({ json: { spec: { storageClassName: "local-path" } } }),
      recorded,
    );
    const probes = buildHealthProbes(k8sEnv(), client);
    const result = await probes.probePantry?.();

    expect(result).toEqual({
      ok: true,
      className: "p0rt1on-pantry",
      clusterDefault: "local-path",
    });
    // A POST that isn't dry-run would leave a real PVC behind on every boot.
    expect(recorded[0].method).toBe("POST");
    expect(recorded[0].query).toContain("dryRun=All");
  });

  it("probePantry: the pantry being the cluster default is caught", async () => {
    const client = fakeKubeClient(() => ({
      json: { spec: { storageClassName: "p0rt1on-pantry" } },
    }));
    const probes = buildHealthProbes(k8sEnv(), client);
    expect(await probes.probePantry?.()).toEqual({
      ok: false,
      className: "p0rt1on-pantry",
      reason: "is-default",
    });
  });

  it("probePantry: a cluster with no default class reads as null", async () => {
    const client = fakeKubeClient(() => ({ json: { spec: {} } }));
    const probes = buildHealthProbes(k8sEnv(), client);
    expect(await probes.probePantry?.()).toEqual({
      ok: true,
      className: "p0rt1on-pantry",
      clusterDefault: null,
    });
  });

  it("probePantry: unverifiable (e.g. RBAC not yet granted) warns, doesn't misreport missing", async () => {
    const client = fakeKubeClient(() => ({
      status: 403,
      json: { message: "storageclasses.storage.k8s.io is forbidden" },
    }));
    const probes = buildHealthProbes(k8sEnv(), client);
    const result = await probes.probePantry?.();
    expect(result?.ok).toBe(false);
    if (result?.ok === false && result.reason === "unverifiable") {
      expect(result.error).toContain("403");
    } else {
      throw new Error("expected an unverifiable result");
    }
  });
});
