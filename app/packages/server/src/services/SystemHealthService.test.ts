import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  type SystemHealthConfig,
  TailnetSystemHealthService,
} from "./SystemHealthService.ts";
import { mockTailscaleApi, noopLogger } from "../test-helpers/mocks.ts";
import { ServiceError } from "../lib/ServiceError.ts";
import type { TailscaleApi } from "../tailscale/tailscale.ts";
import type { HealthCheckId, HealthStatus } from "@p0rt1on/shared/domain";

describe("TailnetSystemHealthService", () => {
  const NOW = () => Date.parse("2026-06-30T12:00:00Z");
  const BASE: SystemHealthConfig = {
    serveMode: "https",
    serveNodeTag: "tag:p0rt1on-serve",
    aclMode: "auto",
  };

  const service = (ts: TailscaleApi, over: Partial<SystemHealthConfig> = {}) =>
    new TailnetSystemHealthService(ts, { ...BASE, ...over }, noopLogger(), NOW);

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
});
