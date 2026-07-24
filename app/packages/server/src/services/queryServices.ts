import type {
  ActivityView,
  AuditAction,
  AuditEntryView,
  UsageView,
} from "@p0rt1on/shared/domain";
import type { FriendQueries } from "../db/FriendQueries.ts";
import type { ProvisioningRepo } from "../provisioning/deps.ts";
import { NotImplementedError } from "../lib/ServiceError.ts";
import type { ActivityService, AuditService, UsageService } from "./types.ts";

// ============================================================================
// Thin read-side services: each is a small wrapper over FriendQueries with no
// external side effects (the orchestration lives in FriendService.ts).
// ActivityService.stream is still NOT_IMPLEMENTED until the audit-event bus
// lands (#9).
// ============================================================================

export class UsageServiceImpl implements UsageService {
  constructor(private readonly queries: FriendQueries) {}

  history(friendId: number, limit: number): Promise<UsageView[]> {
    return this.queries.usageHistory(friendId, limit);
  }
}

export class AuditServiceImpl implements AuditService {
  constructor(
    private readonly queries: FriendQueries,
    // The write side lives on the repo; only `audit` is needed here.
    private readonly writer: Pick<ProvisioningRepo, "audit">,
  ) {}

  list(limit: number, before?: number): Promise<AuditEntryView[]> {
    return this.queries.recentAuditEntries(limit, before);
  }

  record(action: AuditAction, detail?: string): Promise<void> {
    return this.writer.audit(null, action, detail);
  }
}

export class ActivityServiceImpl implements ActivityService {
  constructor(private readonly queries: FriendQueries) {}

  current(friendId: number): Promise<ActivityView> {
    return this.queries.activityFor(friendId);
  }

  // The live stream needs the audit-event bus — pending the aggregator impl.
  // Returns an iterable that throws on iteration (so the subscription errors).
  stream(_friendId: number, _signal: AbortSignal): AsyncIterable<ActivityView> {
    return {
      [Symbol.asyncIterator]() {
        throw new NotImplementedError(
          "ActivityService.stream not implemented",
        );
      },
    };
  }
}
