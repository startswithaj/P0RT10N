import type {
  ActivityView,
  AddFriendInput,
  AuditAction,
  AuditEntryView,
  FriendBundle,
  FriendDetail,
  FriendListItem,
  HostnameWarning,
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

export interface FriendService {
  list(): Promise<FriendListItem[]>;
  /** Only friends with a mismatch; absent means healthy. */
  hostnameWarnings(): Promise<HostnameWarning[]>;
  get(friendId: number): Promise<FriendDetail>;
  resize(friendId: number, quotaBytes: number): Promise<FriendDetail>;
  suspend(friendId: number): Promise<FriendDetail>;
  resume(friendId: number): Promise<FriendDetail>;
}

/**
 * The two methods that return a FriendBundle expose once-shown secrets;
 * callers must not persist or log the result.
 */
export interface ProvisioningService {
  addFriend(input: AddFriendInput): Promise<FriendBundle>;
  addFriendStream(
    input: AddFriendInput,
  ): AsyncGenerator<ProgressEvent<ProvisionStepKey, FriendBundle>>;
  rotateKey(friendId: number): Promise<FriendBundle>;
  reissueTsKey(friendId: number): Promise<TsKeyBundle>;
  offboard(friendId: number): Promise<OffboardResult>;
  offboardStream(
    friendId: number,
  ): AsyncGenerator<ProgressEvent<OffboardStepKey, OffboardResult>>;
  /** Reaps both partial resources and their rows, not rows alone. */
  sweepFailed(): Promise<number>;
  recoverStaleProvisioning(): Promise<string[]>;
  /** Rate-limited to 1 per minute. */
  resendInvite(friendId: number): Promise<void>;
  inviteStatus(friendId: number): Promise<InviteStatusView>;
  acceptHostname(friendId: number): Promise<void>;
  retryHostnameClaim(
    friendId: number,
  ): Promise<{ reclaimed: boolean; hostname: string }>;
}

export interface UsageService {
  history(friendId: number, limit: number): Promise<UsageView[]>;
}

export interface AuditService {
  list(limit: number, before?: number): Promise<AuditEntryView[]>;
  /** For system-level events with no friend, such as login/logout and failed actions. */
  record(action: AuditAction, detail?: string): Promise<void>;
}

export interface InventoryService {
  snapshot(): Promise<StatusView>;
  diagnose(instanceName: string): Promise<InstanceDiagnostics>;
}

/**
 * `reportServeUnavailable` escalates the HTTPS-serve check to blocked once a
 * real provision proves it is off, since that check can't be verified via the API alone.
 */
export interface SystemHealthService {
  probe(): Promise<SystemHealth>;
  current(): SystemHealth;
  reportServeUnavailable(reason: string): void;
}

export interface ActivityService {
  current(friendId: number): Promise<ActivityView>;
}

/** Severity levels ordered from least to most severe; records below the configured level are dropped. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * `child` returns a logger that merges `bindings` into every record's meta,
 * so context like `friendId` only needs to be bound once per flow.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}
