// Shared status-service shape used by StatusPage and its ServiceRow.

// `pending` = teardown-in-progress (reaping): the container is going away on
// purpose, so a failing health probe is expected — shown as transient, not down.
// `lost` = down AND the data is gone: the backups are unrecoverable.
export type SvcState = "up" | "provisioning" | "pending" | "down" | "lost";
export type Svc = {
  name: string;
  detail: string;
  state: SvcState;
  instance?: string;
  /** Last-24h hourly request counts (oldest→newest) driving the row sparkline;
   * present on MinIO rows only (empty ⇒ flat baseline). */
  spark?: number[];
};

export function stateLabel(s: SvcState): string {
  if (s === "up") return "Up";
  if (s === "provisioning") return "Provisioning";
  if (s === "pending") return "Offboarding";
  if (s === "lost") return "Data lost";
  return "Down";
}
