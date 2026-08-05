import type { SystemHealth } from "@p0rt1on/shared/domain";
import type { Logger } from "../services/types.ts";

/**
 * Writes the preflight result to the log in full.
 *
 * Every non-ok check gets its own line with its title and detail, because the
 * person hitting these is usually reading container logs on a manager that
 * won't work, not looking at the admin UI. `ok` checks are named in the
 * summary but not explained — their detail on every healthy boot would be
 * pure noise.
 *
 * Lives here rather than in main.ts so it can be tested: main.ts runs its
 * whole boot sequence on import.
 */
export function reportPreflight(health: SystemHealth, logger: Logger): void {
  health.checks.filter((c) => c.status !== "ok").forEach((c) =>
    (c.status === "blocked" ? logger.error : logger.warn)(
      `preflight ${c.status}: ${c.title} — ${c.detail}`,
      { check: c.id, ...(c.fixUrl ? { fixUrl: c.fixUrl } : {}) },
    )
  );

  const idsWith = (status: string) =>
    health.checks.filter((c) => c.status === status).map((c) => c.id);

  const summary = {
    checks: health.checks.length,
    ok: idsWith("ok"),
    warn: idsWith("warn"),
    blocked: idsWith("blocked"),
  };

  if (health.canProvision) {
    logger.info("preflight ok", summary);
    return;
  }
  // error, not warn: a blocked check disables portion creation entirely, which
  // is a louder fact than the per-check lines above convey on their own.
  logger.error(
    "preflight found blocking issues — portion creation is disabled",
    summary,
  );
}
