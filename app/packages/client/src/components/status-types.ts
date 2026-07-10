// Shared status-service shape used by StatusPage and its ServiceRow.

export type SvcState = "up" | "provisioning" | "down";
export type Svc = {
  name: string;
  detail: string;
  state: SvcState;
  instance?: string;
};

export function stateLabel(s: SvcState): string {
  if (s === "up") return "Up";
  if (s === "provisioning") return "Provisioning";
  return "Down";
}
