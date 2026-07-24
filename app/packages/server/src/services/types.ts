import type {
  ActivityView,
  AddFriendInput,
  AuditAction,
  AuditEntryView,
  FriendBundle,
  FriendDetail,
  FriendListItem,
  InviteStatusView,
  OffboardResult,
  OffboardStepKey,
  ProvisionStepKey,
  StatusView,
  SystemHealth,
  TsKeyBundle,
  UsageView,
} from "@p0rt1on/shared/domain";
import type { InstanceDiagnostics } from "../runtime/runtime.ts";
import type { ProgressEvent } from "../lib/progress.ts";

// Service contracts the tRPC routers depend on. Routers stay thin: validate
// input (zod) and delegate. Implementations are injected via TrpcContext, so
// routers carry no business logic and tests can mock them.

/** Read + lightweight mutate over existing friends. */
export interface FriendService {
  list(): Promise<FriendListItem[]>;
  get(friendId: number): Promise<FriendDetail>;
  resize(friendId: number, quotaBytes: number): Promise<FriendDetail>;
  suspend(friendId: number): Promise<FriendDetail>;
  resume(friendId: number): Promise<FriendDetail>;
}

/**
 * The provisioning state machine and its destructive siblings. The two methods
 * that return a FriendBundle expose the once-shown secrets — callers must not
 * persist or log the result.
 */
export interface ProvisioningService {
  addFriend(input: AddFriendInput): Promise<FriendBundle>;
  /** Streaming addFriend: per-step progress then a `done` event with the bundle. */
  addFriendStream(
    input: AddFriendInput,
  ): AsyncGenerator<ProgressEvent<ProvisionStepKey, FriendBundle>>;
  rotateKey(friendId: number): Promise<FriendBundle>;
  /** Mint a fresh Tailscale enrollment key for the friend's node tag. */
  reissueTsKey(friendId: number): Promise<TsKeyBundle>;
  offboard(friendId: number): Promise<OffboardResult>;
  /** Streaming offboard: per-step teardown progress then a `done` event. */
  offboardStream(
    friendId: number,
  ): AsyncGenerator<ProgressEvent<OffboardStepKey, OffboardResult>>;
  /** Reap failed-provision tombstones (partial resources + rows). Returns count. */
  sweepFailed(): Promise<number>;
  /** Boot recovery: fail stale `provisioning` rows; returns names. */
  recoverStaleProvisioning(): Promise<string[]>;
  /** Resend an invited friend's pending Tailscale invite (rate-limited 1/min). */
  resendInvite(friendId: number): Promise<void>;
  /** Reconcile + return an invited friend's current enrollment status. */
  inviteStatus(friendId: number): Promise<InviteStatusView>;
}

/** Point-in-time usage history (`mc du` samples). */
export interface UsageService {
  history(friendId: number, limit: number): Promise<UsageView[]>;
}

/** The audit log — read the trail, and record system-level events (auth, failed
 * mutations) that don't belong to a single service's success path. */
export interface AuditService {
  list(limit: number, before?: number): Promise<AuditEntryView[]>;
  /** Append a system row (no friend) — login/logout and failed actions. */
  record(action: AuditAction, detail?: string): Promise<void>;
}

/** System inventory for the ops/Status page (instances + nodes + host health). */
export interface InventoryService {
  snapshot(): Promise<StatusView>;
  /** Deep diagnostics for one instance (state + health reason + logs). */
  diagnose(instanceName: string): Promise<InstanceDiagnostics>;
}

/**
 * Boot preflight: probes the tailnet prerequisites provisioning needs (API
 * reachable, MagicDNS, serve tag) and latches the result so the client can
 * banner + gate portion creation. `probe` runs the checks; `current` returns
 * the latched report; `reportServeUnavailable` escalates the (API-unprovable)
 * HTTPS-serve check to blocked when a real provision proves it off.
 */
export interface SystemHealthService {
  probe(): Promise<SystemHealth>;
  current(): SystemHealth;
  reportServeUnavailable(reason: string): void;
}

/**
 * Live activity. `stream` yields an ActivityView each time the aggregator
 * updates the friend's record; the router adapts it to a tRPC SSE subscription.
 */
export interface ActivityService {
  current(friendId: number): Promise<ActivityView>;
  stream(friendId: number, signal: AbortSignal): AsyncIterable<ActivityView>;
}

/** Severity levels, low → high. Records below the configured level are dropped. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Structured logger. `child` returns a logger that merges `bindings` into every
 * record's meta — bind `friendId`/`op`/`reqId` once at the top of a flow and
 * every line underneath carries them, so a provisioning run is greppable end to
 * end.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}
