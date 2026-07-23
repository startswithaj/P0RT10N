import type { QueryHandler } from "./types.ts";
import type { DemoFriend, DemoState } from "../state.ts";
import { requireFriend, toDetail, toListItem } from "../state.ts";
import type {
  AuditEntryView,
  InstanceStatus,
  InviteStatusView,
  ServiceStatus,
  StatusView,
} from "@p0rt1on/shared/domain";

const friendId = (input: unknown): number =>
  (input as { friendId: number }).friendId;

const inviteView = (f: DemoFriend): InviteStatusView => ({
  status: f.inviteStatus ?? "manual",
  email: f.inviteEmail ?? `${f.name}@example.com`,
  inviteUrl: f.inviteUrl,
  emailedAt: f.inviteEmailedAt,
});

const pageAudit = (
  audit: AuditEntryView[],
  input: unknown,
): AuditEntryView[] => {
  const { limit, before } = input as { limit?: number; before?: number };
  const rows = before === undefined
    ? audit
    : audit.filter((e) => e.id < before);
  return rows.slice(0, limit ?? 20);
};

// instanceStatus → Status-page health. reaping is a transient teardown (pending),
// everything else that isn't up/coming-up reads as down.
const MINIO_STATE: Record<InstanceStatus, ServiceStatus["state"]> = {
  active: "up",
  provisioning: "provisioning",
  reaping: "pending",
  stopped: "down",
  failed: "down",
};

const minioState = (s: InstanceStatus): ServiceStatus["state"] =>
  MINIO_STATE[s];

// Last-24h hourly request counts for the row sparkline. Only "up" instances plot
// one (a down/provisioning instance isn't serving, so there's nothing to chart —
// and keeping sparklines to same-width "Up" pills keeps the column aligned). An
// up-but-idle friend returns all-zeros → Sparkline draws a dashed baseline;
// active friends get deterministic per-friend, per-hour variation (stable across
// reloads, non-zero newest bucket) so no two rows look alike.
const sparkFor = (f: DemoFriend): number[] | undefined => {
  if (f.instanceStatus !== "active") return undefined;
  const per = f.activity.requests24h;
  if (per <= 0) return Array.from({ length: 24 }, () => 0);
  const avg = per / 24;
  return Array.from({ length: 24 }, (_, h) => {
    const noise = Math.sin((h + 1) * 12.9898 + f.id * 78.233) * 43758.5453;
    const frac = noise - Math.floor(noise); // deterministic 0..1
    const scale = h === 23 ? 1.3 : 0.35 + 1.2 * frac; // recent bucket stands out
    return Math.max(1, Math.round(avg * scale));
  });
};

const buildStatus = (state: DemoState): StatusView => ({
  minio: state.friends.map((f): ServiceStatus => ({
    name: `${f.name}-minio`,
    detail: f.s3Endpoint,
    state: minioState(f.instanceStatus),
    instance: `${f.name}-minio`,
    spark: sparkFor(f),
  })),
  tailscale: state.friends
    .filter((f) => f.nodeOnline)
    .map((f): ServiceStatus => ({
      name: `${f.name}-node`,
      detail: "node online",
      state: "up",
    }))
    .concat([{ name: "manager", detail: "tailnet node online", state: "up" }]),
  host: [{ name: "manager", detail: "manager daemon", state: "up" }],
});

// status.diagnose output = InstanceDiagnostics (server type); shape matched here.
const diagnose = (instanceName: string): unknown => ({
  name: instanceName,
  state: "running",
  health: "healthy",
  healthReason: null,
  exitCode: null,
  exitError: null,
  recentLogs:
    "API: SYSTEM\nMinIO Object Storage Server\nStatus: 1 Online, 0 Offline.",
});

export const queryHandlers: Record<string, QueryHandler> = {
  "auth.status": () => ({ enabled: false, authenticated: true }),
  "friends.list": (_input, state) => state.friends.map(toListItem),
  "friends.get": (input, state) =>
    toDetail(requireFriend(state, friendId(input))),
  "friends.capabilities": () => ({ inviteApiConfigured: true }),
  "friends.inviteStatus": (input, state) =>
    inviteView(requireFriend(state, friendId(input))),
  "usage.history": (input, state) => [
    requireFriend(state, friendId(input)).usage,
  ],
  "activity.current": (input, state) =>
    requireFriend(state, friendId(input)).activity,
  "audit.list": (input, state) => pageAudit(state.audit, input),
  "status.get": (_input, state) => buildStatus(state),
  "status.diagnose": (input) =>
    diagnose((input as { instanceName: string }).instanceName),
};
