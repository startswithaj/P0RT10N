import type { QueryHandlers } from "./types.ts";
import type { QueryOutput } from "../paths.ts";
import type { DemoFriend, DemoState } from "../state.ts";
import { requireFriend, toDetail, toListItem } from "../state.ts";
import type {
  AuditEntryView,
  InstanceStatus,
  InviteStatusView,
  ServiceStatus,
  StatusView,
} from "@p0rt1on/shared/domain";

const inviteView = (f: DemoFriend): InviteStatusView => ({
  status: f.inviteStatus ?? "manual",
  email: f.inviteEmail ?? `${f.name}@example.com`,
  inviteUrl: f.inviteUrl,
  emailedAt: f.inviteEmailedAt,
});

const pageAudit = (
  audit: AuditEntryView[],
  input: { limit?: number; before?: number },
): AuditEntryView[] => {
  const { limit, before } = input;
  const rows = before === undefined
    ? audit
    : audit.filter((e) => e.id < before);
  return rows.slice(0, limit ?? 20);
};

// This maps instance status to status-page health: reaping is a transient
// teardown so it reads as pending, and anything else not up or coming up reads as down.
const MINIO_STATE: Record<InstanceStatus, ServiceStatus["state"]> = {
  active: "up",
  provisioning: "provisioning",
  reaping: "pending",
  stopped: "down",
  failed: "down",
};

const minioState = (s: InstanceStatus): ServiceStatus["state"] =>
  MINIO_STATE[s];

// Sparkline values are deterministic per friend and hour, using a hashed sine
// wave so they stay stable across reloads, with the newest bucket boosted so recent activity stands out.
const sparkFor = (f: DemoFriend): number[] | undefined => {
  if (f.instanceStatus !== "active") return undefined;
  const per = f.activity.requests24h;
  if (per <= 0) return Array.from({ length: 24 }, () => 0);
  const avg = per / 24;
  return Array.from({ length: 24 }, (_, h) => {
    const noise = Math.sin((h + 1) * 12.9898 + f.id * 78.233) * 43758.5453;
    const frac = noise - Math.floor(noise);
    const scale = h === 23 ? 1.3 : 0.35 + 1.2 * frac;
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

// The return type is pinned to the router's inferred InstanceDiagnostics output,
// so a server-side shape change becomes a compile error here rather than a silent drift.
const diagnose = (
  instanceName: string,
): QueryOutput<"status.diagnose"> => ({
  name: instanceName,
  state: "running",
  health: "healthy",
  healthReason: null,
  exitCode: null,
  exitError: null,
  recentLogs:
    "API: SYSTEM\nMinIO Object Storage Server\nStatus: 1 Online, 0 Offline.",
});

// This map must cover every query path with input and output types inferred
// from the actual router, so a wrong shape is a compile error, not a runtime bug.
export const queryHandlers: QueryHandlers = {
  "auth.status": () => ({ enabled: false, authenticated: true }),
  "friends.list": (_input, state) => state.friends.map(toListItem),
  // Demo portions never hold a mismatched hostname, matching the no-op
  // accept/retry mutations.
  "friends.hostnameWarnings": () => [],
  "friends.get": (input, state) =>
    toDetail(requireFriend(state, input.friendId)),
  "friends.capabilities": () => ({ inviteApiConfigured: true }),
  "friends.inviteStatus": (input, state) =>
    inviteView(requireFriend(state, input.friendId)),
  "usage.history": (input, state) => [
    requireFriend(state, input.friendId).usage,
  ],
  "activity.current": (input, state) =>
    requireFriend(state, input.friendId).activity,
  "audit.list": (input, state) => pageAudit(state.audit, input),
  "status.get": (_input, state) => buildStatus(state),
  "status.diagnose": (input) => diagnose(input.instanceName),
  "status.health": () => ({
    checks: [],
    canProvision: true,
    probedAt: "2026-06-30T12:00:00Z",
  }),
};
