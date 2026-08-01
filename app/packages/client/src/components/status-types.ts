// `pending` means teardown is already in progress, so a failing health probe there
// is expected rather than a real outage. `lost` means the service is down and its data is gone for good.
export type SvcState = "up" | "provisioning" | "pending" | "down" | "lost";
export type Svc = {
  name: string;
  detail: string;
  state: SvcState;
  instance?: string;
  /** Last 24h of hourly request counts, ordered oldest to newest, for the row's
   * sparkline. Only present on MinIO rows; an empty array renders a flat baseline. */
  spark?: number[];
};

export function stateLabel(s: SvcState): string {
  if (s === "up") return "Up";
  if (s === "provisioning") return "Provisioning";
  if (s === "pending") return "Offboarding";
  if (s === "lost") return "Data lost";
  return "Down";
}
