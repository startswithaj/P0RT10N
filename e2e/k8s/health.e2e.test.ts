import { beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { requireConfig, trpcClient, until } from "../helpers.ts";

// Startup health checks against a genuinely broken cluster: run.ts breaks one
// thing from the host, then this asks the manager what its checks say.
// HEALTH_SCENARIO names the break in effect.
describe("Startup health checks against a broken cluster (e2e)", () => {
  beforeAll(() =>
    requireConfig({
      env: [
        "MANAGER_URL",
        "P0RT1ON_ADMIN_USERNAME",
        "P0RT1ON_ADMIN_PASSWORD",
        "HEALTH_SCENARIO",
      ],
      hint: "run via deno task test:e2e:k8s health (it sets the scenario).",
    })
  );

  const env = (k: string) => Deno.env.get(k) ?? "";
  const scenario = () => env("HEALTH_SCENARIO");
  const trpc = trpcClient(env("MANAGER_URL"));

  type Health = {
    canProvision: boolean;
    checks: { id: string; status: string; title: string; detail: string }[];
  };

  const login = () =>
    trpc("auth.login", {
      username: env("P0RT1ON_ADMIN_USERNAME"),
      password: env("P0RT1ON_ADMIN_PASSWORD"),
    });

  // recheckHealth re-probes rather than returning the boot-time latch, so the
  // break the driver just applied is actually observed.
  const probe = () => trpc("status.recheckHealth", {}) as Promise<Health>;

  const waitForManager = () =>
    until("manager /health", async () => {
      const res = await fetch(`${env("MANAGER_URL")}/health`).catch(() => null);
      const ok = res?.status === 200;
      await res?.body?.cancel();
      return ok || null;
    }, 30);

  it("reports the scenario's misconfiguration through the health API", async () => {
    await waitForManager();
    await login();
    const health = await probe();
    const check = (id: string) => health.checks.find((c) => c.id === id);

    if (scenario() === "pantry-is-default") {
      const pantry = check("pantry");
      // Portion data sharing the cluster default's path with unrelated volumes
      // is a silent data-siting bug, so this blocks rather than warns.
      expect(pantry?.status).toBe("blocked");
      expect(pantry?.detail).toContain("default StorageClass");
      expect(health.canProvision).toBe(false);
      return;
    }

    if (scenario() === "healthy") {
      // The ok path: a check that could only ever say "blocked" would pass
      // the scenarios above while being useless.
      expect(check("pantry")?.status).toBe("ok");
      expect(check("pantry")?.detail).toContain("isn't the cluster default");
      expect(check("managerService")?.status).toBe("ok");
      // serveTag reads headscale's policy for real. tailscaleApi comes from
      // reads the headscale adapter fakes, so it lives in the docker suite.
      expect(check("serveTag")?.status).toBe("ok");
      // The e2e image has no registry host, which is what this warns about;
      // a warn must not gate provisioning.
      expect(check("instanceImage")?.status).toBe("warn");
      expect(health.canProvision).toBe(true);
      return;
    }

    if (scenario() === "manager-service-missing") {
      const svc = check("managerService");
      // Instances post audit events to this Service by name; if it doesn't
      // resolve, every portion looks idle forever.
      expect(svc?.status).toBe("blocked");
      expect(svc?.detail).toContain("P0RT1ON_K8S_MANAGER_SERVICE_NAME");
      expect(health.canProvision).toBe(false);
      return;
    }

    throw new Error(`unknown HEALTH_SCENARIO: ${scenario()}`);
  });
});
