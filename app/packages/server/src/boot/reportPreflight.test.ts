import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { reportPreflight } from "./reportPreflight.ts";
import { capturingLogger } from "../test-helpers/mocks.ts";
import type { HealthCheck, SystemHealth } from "@p0rt1on/shared/domain";

describe("reportPreflight", () => {
  const check = (over: Partial<HealthCheck> = {}): HealthCheck => ({
    id: "pantry",
    status: "ok",
    title: "Pantry",
    detail: "StorageClass p0rt1on-pantry exists.",
    ...over,
  });

  const health = (checks: HealthCheck[]): SystemHealth => ({
    checks,
    canProvision: !checks.some((c) => c.status === "blocked"),
    probedAt: "2026-06-30T12:00:00Z",
  });

  it("logs a blocked check's own words at error, not just its id", () => {
    const { logger, lines } = capturingLogger();
    reportPreflight(
      health([check({
        status: "blocked",
        title: "Pantry StorageClass not found",
        detail:
          "StorageClass p0rt1on-pantry (P0RT1ON_PANTRY) does not exist. Apply deploy/k8s/pantry.yaml.",
      })]),
      logger,
    );

    const line = lines.find((l) => l.message.startsWith("preflight blocked"));
    expect(line?.level).toBe("error");
    // The whole point: the fix is readable from the log alone.
    expect(line?.message).toContain("Pantry StorageClass not found");
    expect(line?.message).toContain("P0RT1ON_PANTRY");
    expect(line?.message).toContain("apply deploy/k8s/pantry.yaml".slice(1));
    expect(line?.meta?.check).toBe("pantry");
  });

  it("logs a warn check at warn, and never blocks provisioning over it", () => {
    const { logger, lines } = capturingLogger();
    reportPreflight(
      health([check({
        id: "instanceImage",
        status: "warn",
        title: "Instance image has no registry host",
        detail: 'P0RT1ON_INSTANCE_IMAGE is "p0rt1on-instance:latest".',
      })]),
      logger,
    );

    const line = lines.find((l) => l.message.startsWith("preflight warn"));
    expect(line?.level).toBe("warn");
    expect(line?.message).toContain("P0RT1ON_INSTANCE_IMAGE");
    expect(lines.find((l) => l.message === "preflight ok")?.level).toBe("info");
  });

  it("names ok checks in the summary but does not repeat their detail", () => {
    const { logger, lines } = capturingLogger();
    reportPreflight(
      health([
        check({ id: "magicDns", detail: "MagicDNS is enabled." }),
        check({ id: "serveTag", detail: "Serve tag is owned." }),
      ]),
      logger,
    );

    expect(lines).toHaveLength(1); // no per-check lines for ok
    expect(lines[0].level).toBe("info");
    expect(lines[0].meta?.ok).toEqual(["magicDns", "serveTag"]);
    expect(lines[0].message).not.toContain("MagicDNS is enabled");
  });

  it("says provisioning is disabled, and buckets every id by status", () => {
    const { logger, lines } = capturingLogger();
    reportPreflight(
      health([
        check({ id: "magicDns", status: "ok" }),
        check({ id: "instanceImage", status: "warn" }),
        check({ id: "pantry", status: "blocked" }),
      ]),
      logger,
    );

    const summary = lines.find((l) => l.message.includes("blocking issues"));
    expect(summary?.level).toBe("error");
    expect(summary?.message).toContain("portion creation is disabled");
    expect(summary?.meta).toEqual({
      checks: 3,
      ok: ["magicDns"],
      warn: ["instanceImage"],
      blocked: ["pantry"],
    });
  });

  it("carries fixUrl through so the link reaches the log too", () => {
    const { logger, lines } = capturingLogger();
    reportPreflight(
      health([check({
        id: "magicDns",
        status: "warn",
        fixUrl: "https://login.tailscale.com/admin/dns",
      })]),
      logger,
    );

    expect(lines[0].meta?.fixUrl).toBe("https://login.tailscale.com/admin/dns");
  });

  it("omits fixUrl entirely when a check has none", () => {
    const { logger, lines } = capturingLogger();
    reportPreflight(health([check({ status: "warn" })]), logger);
    expect(Object.keys(lines[0].meta ?? {})).toEqual(["check"]);
  });
});
