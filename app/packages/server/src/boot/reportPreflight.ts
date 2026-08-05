import type { SystemHealth } from "@p0rt1on/shared/domain";
import type { Logger } from "../services/types.ts";

/** Writes the preflight result to the log in full: whoever hits these is
 * reading container logs on a manager that won't work, not the admin UI. `ok`
 * checks are named but not explained. Lives here, not main.ts, so it can be
 * tested — main.ts runs its whole boot sequence on import. */
export function reportPreflight(health: SystemHealth, logger: Logger): void {
  health.checks.filter((c) => c.status !== "ok").forEach((c) => {
    const message = `preflight ${c.status}: ${c.title} — ${c.detail}`;
    const meta = { check: c.id, ...(c.fixUrl ? { fixUrl: c.fixUrl } : {}) };
    // Called as methods, not picked into a variable: the real logger's are
    // class methods using `this`, so a bare reference is unbound and throws.
    if (c.status === "blocked") logger.error(message, meta);
    else logger.warn(message, meta);
  });

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
