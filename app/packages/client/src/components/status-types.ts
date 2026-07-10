// Shared status-service shape used by StatusPage and its ServiceRow.

// `pending` = teardown-in-progress (reaping): the container is going away on
// purpose, so a failing health probe is expected — shown as transient, not down.
export type SvcState = "up" | "provisioning" | "pending" | "down";
export type Svc = {
  name: string;
  detail: string;
  state: SvcState;
  instance?: string;
};

export function stateLabel(s: SvcState): string {
  if (s === "up") return "Up";
  if (s === "provisioning") return "Provisioning";
  if (s === "pending") return "Offboarding";
  return "Down";
}
